/* CESAR SATELLITE — конструктор отчётов.
   Сервер без внешних зависимостей: раздаёт статику, хранит отчёты в data/reports/<id>.json,
   отдаёт публичные страницы /r/<id>. Запуск: node server.js  (порт по умолчанию 4600) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4600;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data', 'reports');
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
function safeId(id) { return /^[a-zA-Z0-9_-]{4,40}$/.test(id) ? id : null; }
function genId() { return crypto.randomBytes(6).toString('hex'); }

function serveFile(res, file) {
  fs.readFile(file, function (err, data) {
    if (err) { send(res, 404, 'Not found'); return; }
    var ext = path.extname(file).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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

const server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  var pathname = decodeURIComponent(url.pathname);

  // --- API: создать отчёт ---
  if (req.method === 'POST' && pathname === '/api/reports') {
    readBody(req).then(function (raw) {
      var data;
      try { data = JSON.parse(raw); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
      data = clean(data);
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
      if (err) return sendJSON(res, 404, { error: 'not found' });
      send(res, 200, txt, { 'Content-Type': 'application/json; charset=utf-8' });
    });
    return;
  }

  // --- публичная страница отчёта /r/<id> ---
  if (req.method === 'GET' && /^\/r\/[^/]+$/.test(pathname)) {
    return serveFile(res, path.join(PUB, 'report.html'));
  }

  // --- статика ---
  if (req.method === 'GET') {
    var rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    var filePath = path.normalize(path.join(PUB, rel));
    if (filePath.indexOf(PUB) !== 0) { send(res, 403, 'Forbidden'); return; }
    fs.stat(filePath, function (err, st) {
      if (!err && st.isFile()) return serveFile(res, filePath);
      // фолбэк на index
      serveFile(res, path.join(PUB, 'index.html'));
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
