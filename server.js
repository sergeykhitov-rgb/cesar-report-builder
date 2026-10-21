/* CESAR SATELLITE — конструктор отчётов.
   Сервер без внешних зависимостей: раздаёт статику, хранит отчёты в data/reports/<id>.json,
   отдаёт публичные страницы /r/<id>. Запуск: node server.js  (порт по умолчанию 4600) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { ZipArchive } = require('archiver');
const { MIME_XLSX, buildEstimateWorkbook, estimateFilename, uniqueEstimateFilenames } = require('./lib/xlsx-export');

const PORT = process.env.PORT || 4600;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data', 'reports');
const SEED = path.join(ROOT, 'seed'); // встроенные постоянные отчёты (в образе, переживают перезапуск)
const MAX_BODY = 30 * 1024 * 1024; // 30 МБ (фото в base64)

fs.mkdirSync(DATA, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function attachmentHeader(asciiName, unicodeName) {
  return 'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(unicodeName).replace(/[!'()*]/g, function (char) {
    return '%' + char.charCodeAt(0).toString(16).toUpperCase();
  });
}

function exportGroupsFromItems(items) {
  if (!Array.isArray(items) || !items.length) {
    var emptyError = new Error('items are required'); emptyError.code = 'INVALID_EXPORT'; emptyError.path = 'items'; throw emptyError;
  }
  var groups = [], seen = Object.create(null);
  items.forEach(function (item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.system !== 'string' || !item.system.trim()) {
      var error = new Error('item system is required'); error.code = 'INVALID_EXPORT'; error.path = 'items.' + index + '.system'; throw error;
    }
    var id = item.system.trim();
    if (seen[id]) return;
    seen[id] = true;
    groups.push({ id: id, label: typeof item.systemLabel === 'string' && item.systemLabel.trim() ? item.systemLabel.trim() : id });
  });
  return groups;
}

function exportError(res, error) {
  if (error && error.code === 'INVALID_EXPORT') {
    return sendJSON(res, 422, { error: 'invalid export', errors: [{ code: error.code, path: error.path || 'export', message: error.message }] });
  }
  console.error(error);
  return sendJSON(res, 500, { error: 'export failed' });
}
function safeId(id) { return /^[a-zA-Z0-9_-]{4,40}$/.test(id) ? id : null; }
function genId() { return crypto.randomBytes(6).toString('hex'); }

function encodingQuality(header, encoding) {
  var explicit = null, wildcard = null;
  String(header || '').split(',').forEach(function (entry) {
    var parts = entry.trim().split(';');
    var name = parts.shift().trim().toLowerCase();
    if (!name) return;
    var quality = 1;
    parts.forEach(function (parameter) {
      var match = /^\s*q\s*=\s*([^\s]+)\s*$/i.exec(parameter);
      if (!match) return;
      var parsed = Number(match[1]);
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    });
    if (name === encoding) explicit = quality;
    else if (name === '*') wildcard = quality;
  });
  return explicit !== null ? explicit : (wildcard !== null ? wildcard : 0);
}

function serveFile(req, res, file) {
  fs.stat(file, function (statError, stat) {
    if (statError || !stat.isFile()) { send(res, 404, 'Not found'); return; }
    var ext = path.extname(file).toLowerCase();
    var isHTML = ext === '.html';
    var compressible = ext === '.js' || ext === '.json';
    var headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHTML ? 'no-store' : 'public, max-age=3600',
      'Last-Modified': stat.mtime.toUTCString()
    };
    if (compressible) headers.Vary = 'Accept-Encoding';
    var modifiedSince = Date.parse(req.headers['if-modified-since'] || '');
    var mtimeAtHeaderPrecision = Math.floor(stat.mtimeMs / 1000) * 1000;
    if (!isHTML && Number.isFinite(modifiedSince) && mtimeAtHeaderPrecision <= modifiedSince) {
      send(res, 304, null, headers);
      return;
    }
    fs.readFile(file, function (readError, data) {
      if (readError) { send(res, 404, 'Not found'); return; }
      var acceptsGzip = encodingQuality(req.headers['accept-encoding'], 'gzip') > 0;
      if ((ext === '.js' || ext === '.json') && acceptsGzip) {
        headers['Content-Encoding'] = 'gzip';
        zlib.gzip(data, function (gzipError, compressed) {
          if (gzipError) { send(res, 500, 'Compression failed'); return; }
          send(res, 200, compressed, headers);
        });
        return;
      }
      send(res, 200, data, headers);
    });
  });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/* лёгкая санитизация: ограничиваем размер строк и структуру */
function clean(v, depth) {
  depth = depth || 0;
  if (depth > 6) return null;
  if (typeof v === 'string') return v.length > 3000000 ? v.slice(0, 3000000) : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map(function (x) { return clean(x, depth + 1); });
  if (typeof v === 'object') {
    var out = {}, n = 0;
    for (var k in v) { if (!Object.prototype.hasOwnProperty.call(v, k)) continue; if (++n > 60) break; out[k] = clean(v[k], depth + 1); }
    return out;
  }
  return null;
}

/* Публичный контракт отчёта: пересобираем разрешённые поля после общей очистки.
   Клиентская проекция полезна для размера запроса, но не является границей доверия. */
function publicReportPayload(input) {
  function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function scalar(value) {
    return typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) || value === null ? value : undefined;
  }
  function fields(value, allowed) {
    var source = record(value), output = {};
    allowed.forEach(function (key) {
      var safe = scalar(source[key]);
      if (safe !== undefined) output[key] = safe;
    });
    return output;
  }
  function list(value, projector) {
    return Array.isArray(value) ? value.map(projector).filter(function (item) { return item !== null; }) : [];
  }
  function stringList(value) {
    return Array.isArray(value) ? value.filter(function (item) { return typeof item === 'string'; }) : [];
  }
  function nonnegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  var source = record(input), output = fields(source, [
    'title', 'subtitle', 'objectTitle', 'heroPhoto', 'eventsTitle', 'disclaimer'
  ]);
  output.object = fields(source.object, ['pin', 'owner', 'brand', 'model', 'plate', 'address']);
  output.summary = fields(source.summary, ['alarms', 'incidents', 'alarmsLabel', 'incidentsLabel', 'extraLabel']);
  output.events = list(source.events, function (event) {
    return event && typeof event === 'object' && !Array.isArray(event)
      ? fields(event, ['signal', 'date', 'time', 'address', 'photo', 'note']) : null;
  });
  output.manager = fields(source.manager, ['label', 'name', 'role', 'phone', 'email', 'photo']);
  output.promotions = list(source.promotions, function (promotion) {
    return promotion && typeof promotion === 'object' && !Array.isArray(promotion)
      ? fields(promotion, ['title', 'description', 'image']) : null;
  });

  if (source.proposal && typeof source.proposal === 'object' && !Array.isArray(source.proposal)) {
    var proposal = record(source.proposal), computed = record(proposal.computed);
    output.proposal = {
      client: fields(proposal.client, ['name', 'phone', 'email']),
      scenario: fields(proposal.scenario, ['segment', 'region', 'objectType', 'tariff', 'rent', 'label']),
      items: list(proposal.items, function (item) {
        return item && typeof item === 'object' && !Array.isArray(item)
          ? fields(item, ['system', 'systemLabel', 'code', 'name', 'model', 'unit', 'quantity', 'installedUnitPrice', 'lineTotal']) : null;
      }),
      selectedOptionNames: stringList(proposal.selectedOptionNames),
      discountPercent: nonnegativeNumber(proposal.discountPercent),
      computed: {
        equipment: fields(computed.equipment, ['subtotal', 'discountAmount', 'afterDiscount']),
        installation: fields(computed.installation, ['final']),
        oneTime: fields(computed.oneTime, ['final']),
        monthlyFee: fields(computed.monthlyFee, ['final']),
        materialLiability: fields(computed.materialLiability, ['final']),
        tariff: fields(computed.tariff, ['resolvedName'])
      }
    };
  }
  return output;
}

function proposalValidationErrors(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'proposal')) return [];
  var proposal = data.proposal || {}, client = proposal.client || {}, scenario = proposal.scenario || {}, computed = proposal.computed || {};
  var errors = [];
  function required(value, path, message) {
    if (typeof value !== 'string' || !value.trim()) errors.push({ code: 'REQUIRED', path: path, message: message });
  }
  function finite(value, path, message) {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push({ code: 'INVALID_TOTAL', path: path, message: message });
  }
  required(client.name, 'proposal.client.name', 'Укажите организацию или имя клиента.');
  if (scenario.segment !== 'B2C' && scenario.segment !== 'B2B') errors.push({ code: 'INVALID_VALUE', path: 'proposal.scenario.segment', message: 'Выберите сегмент B2C или B2B.' });
  required(scenario.region, 'proposal.scenario.region', 'Выберите регион.');
  required(scenario.objectType, 'proposal.scenario.objectType', 'Укажите тип объекта.');
  var items = Array.isArray(proposal.items) ? proposal.items : [];
  if (!items.length) errors.push({ code: 'REQUIRED', path: 'proposal.items', message: 'Добавьте оборудование.' });
  items.forEach(function (item, index) {
    if (!item || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) errors.push({ code: 'INVALID_ITEM', path: 'proposal.items.' + index + '.quantity', message: 'Количество должно быть положительным целым числом.' });
    ['installedUnitPrice', 'lineTotal'].forEach(function (field) {
      if (!item || typeof item[field] !== 'number' || !Number.isFinite(item[field]) || item[field] < 0) errors.push({ code: 'INVALID_ITEM', path: 'proposal.items.' + index + '.' + field, message: 'Цена и сумма позиции должны быть неотрицательными числами.' });
    });
  });
  finite(computed.equipment && computed.equipment.afterDiscount, 'proposal.computed.equipment.afterDiscount', 'Проверьте итог оборудования.');
  finite(computed.installation && computed.installation.final, 'proposal.computed.installation.final', 'Проверьте стоимость монтажа.');
  finite(computed.oneTime && computed.oneTime.final, 'proposal.computed.oneTime.final', 'Проверьте разовый платёж.');
  finite(computed.monthlyFee && computed.monthlyFee.final, 'proposal.computed.monthlyFee.final', 'Проверьте ежемесячный платёж.');
  finite(computed.materialLiability && computed.materialLiability.final, 'proposal.computed.materialLiability.final', 'Проверьте материальную ответственность.');
  return errors;
}

const server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  var pathname = decodeURIComponent(url.pathname);

  // --- API: отдельные сметы оборудования по системам ---
  if (req.method === 'POST' && pathname === '/api/exports/xlsx') {
    readBody(req).then(async function (raw) {
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
      try {
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 200) {
          var tooMany = new Error('items must contain 1..200 entries'); tooMany.code = 'INVALID_EXPORT'; tooMany.path = 'items'; throw tooMany;
        }
        var proposal = clean(parsed);
        var groups = exportGroupsFromItems(proposal && proposal.items);
        var buffers = await Promise.all(groups.map(function (group) { return buildEstimateWorkbook(proposal, group); }));
        if (groups.length === 1) {
          return send(res, 200, buffers[0], {
            'Content-Type': MIME_XLSX,
            'Content-Disposition': attachmentHeader('estimate.xlsx', estimateFilename(proposal, groups[0])),
            'Content-Length': buffers[0].length,
          });
        }
        var names = uniqueEstimateFilenames(proposal, groups);
        var archive = new ZipArchive({ zlib: { level: 9 } });
        archive.on('error', function (error) { if (!res.headersSent) exportError(res, error); else res.destroy(error); });
        res.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/zip',
          'Content-Disposition': attachmentHeader('estimates.zip', 'Сметы оборудования.zip'),
        });
        archive.pipe(res);
        buffers.forEach(function (buffer, index) { archive.append(buffer, { name: names[index], date: new Date('2000-01-01T00:00:00.000Z') }); });
        await archive.finalize();
      } catch (error) { if (res.headersSent) res.destroy(error); else exportError(res, error); }
    }).catch(function () { sendJSON(res, 413, { error: 'payload too large' }); });
    return;
  }

  // --- API: создать отчёт ---
  if (req.method === 'POST' && pathname === '/api/reports') {
    readBody(req).then(function (raw) {
      var data;
      try { data = JSON.parse(raw); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
      data = publicReportPayload(clean(data));
      var validationErrors = proposalValidationErrors(data);
      if (validationErrors.length) return sendJSON(res, 422, { error: 'invalid proposal', errors: validationErrors });
      data.id = genId();
      data.createdAt = new Date().toISOString();
      fs.writeFile(path.join(DATA, data.id + '.json'), JSON.stringify(data), function (err) {
        if (err) { console.error(err); return sendJSON(res, 500, { error: 'write failed' }); }
        sendJSON(res, 200, { id: data.id });
      });
    }).catch(function () { sendJSON(res, 413, { error: 'payload too large' }); });
    return;
  }

  // --- API: получить отчёт ---
  if (req.method === 'GET' && pathname.indexOf('/api/reports/') === 0) {
    var id = safeId(pathname.slice('/api/reports/'.length));
    if (!id) return sendJSON(res, 400, { error: 'bad id' });
    fs.readFile(path.join(DATA, id + '.json'), 'utf8', function (err, txt) {
      if (!err) return send(res, 200, txt, { 'Content-Type': 'application/json; charset=utf-8' });
      // фолбэк на встроенные постоянные отчёты (seed/) — они в образе и не пропадают при перезапуске
      fs.readFile(path.join(SEED, id + '.json'), 'utf8', function (err2, seedTxt) {
        if (err2) return sendJSON(res, 404, { error: 'not found' });
        send(res, 200, seedTxt, { 'Content-Type': 'application/json; charset=utf-8' });
      });
    });
    return;
  }

  // --- публичная страница отчёта /r/<id> ---
  if (req.method === 'GET' && /^\/r\/[^/]+$/.test(pathname)) {
    return serveFile(req, res, path.join(PUB, 'report.html'));
  }

  // --- статика ---
  if (req.method === 'GET') {
    var rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    var filePath = path.normalize(path.join(PUB, rel));
    if (filePath.indexOf(PUB) !== 0) { send(res, 403, 'Forbidden'); return; }
    fs.stat(filePath, function (err, st) {
      if (!err && st.isFile()) return serveFile(req, res, filePath);
      // фолбэк на index
      serveFile(req, res, path.join(PUB, 'index.html'));
    });
    return;
  }

  send(res, 405, 'Method not allowed');
});

server.listen(PORT, function () {
  var nets = require('os').networkInterfaces(), lan = null;
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (ni) {
      if (ni.family === 'IPv4' && !ni.internal && !lan) lan = ni.address;
    });
  });
  console.log('\n  CESAR SATELLITE · конструктор отчётов');
  console.log('  ─────────────────────────────────────');
  console.log('  Локально:  http://localhost:' + PORT);
  if (lan) console.log('  В сети:    http://' + lan + ':' + PORT + '   (для телефона в той же Wi-Fi)');
  console.log('  Отчёты:    ' + DATA + '\n');
});
