const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const ExcelJS = require('exceljs');
const unzipper = require('unzipper');

const ROOT = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function postJSON(port, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function abortPostJSON(port, pathname, payload) {
  return new Promise(resolve => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    });
    req.on('error', () => resolve());
    req.end(body, () => setTimeout(() => { req.destroy(); resolve(); }, 10));
  });
}

function exportPayload(items) {
  return {
    client: { name: 'ООО Тест' },
    object: { pin: '7711', account: 'ЛС-1', invoice: 'Счёт-2', address: 'Москва' },
    generatedAt: '2026-10-21T09:00:00.000Z',
    items,
    discountPercent: 0,
    computed: {
      equipment: { subtotal: 1000, discountAmount: 0, afterDiscount: 1000 },
      installation: { final: 500 }, oneTime: { final: 1500 }, monthlyFee: { final: 1000 }, materialLiability: { final: 50000 },
      tariff: { resolvedName: 'Базовый' },
    },
    selectedOptionNames: ['Тревожная кнопка'],
    promotions: [{ title: 'Выгодная предоплата', description: 'Скидка на охрану.' }],
    manager: { name: 'Андрей Мешенков', role: 'Менеджер', phone: '+7 495 000-00-00', email: 'manager@example.test' },
  };
}

async function workbookStrings(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0].getSheetValues().flat(2).map(value => typeof value === 'object' && value ? value.result || value.formula || '' : value).join(' | ');
}

async function startServer(t) {
  const port = await freePort();
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cesar-server-reports-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), REPORTS_DIR: reportsDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); fs.rmSync(reportsDir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 3000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`localhost:${port}`)) { clearTimeout(timer); resolve(); }
    });
  });
  return port;
}

test('static JavaScript is gzip-compressed and publicly cacheable with validation metadata', async t => {
  const port = await startServer(t);
  const response = await request(port, '/calculator-catalogs.js', { 'Accept-Encoding': 'gzip' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(response.headers.vary, /Accept-Encoding/i);
  assert.match(response.headers['cache-control'], /^public, max-age=/);
  assert.ok(response.headers.etag || response.headers['last-modified']);
  const decoded = zlib.gunzipSync(response.body).toString('utf8');
  assert.match(decoded, /^\(function\(\)/);
});

test('If-Modified-Since returns 304 without a response body at HTTP-date precision', async t => {
  const port = await startServer(t);
  const first = await request(port, '/calculator-catalogs.js');
  const response = await request(port, '/calculator-catalogs.js', { 'If-Modified-Since': first.headers['last-modified'] });

  assert.equal(first.status, 200);
  assert.ok(first.headers['last-modified']);
  assert.equal(response.status, 304);
  assert.equal(response.body.length, 0);
  assert.match(response.headers['cache-control'], /^public, max-age=/);
});

test('explicit gzip q=0 prevents compression even when wildcard allows other encodings', async t => {
  const port = await startServer(t);
  const response = await request(port, '/calculator-catalogs.js', { 'Accept-Encoding': 'br;q=1, *;q=0.8, gzip;q=0' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], undefined);
  assert.match(response.headers.vary, /Accept-Encoding/i);
  assert.match(response.body.toString('utf8'), /^\(function\(\)/);
});

test('wildcard Accept-Encoding enables gzip when gzip has no explicit quality', async t => {
  const port = await startServer(t);
  const response = await request(port, '/calculator-catalogs.js', { 'Accept-Encoding': 'br;q=1, *;q=0.5' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(zlib.gunzipSync(response.body).toString('utf8'), /^\(function\(\)/);
});

test('HTML remains no-store and is not gzip-compressed by static JS/JSON policy', async t => {
  const port = await startServer(t);
  const response = await request(port, '/', { 'Accept-Encoding': 'gzip' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['content-encoding'], undefined);
});

test('POST reports stores only the server-side public report allowlist', async t => {
  const port = await startServer(t);
  const photo = 'data:image/png;base64,dmFsaWQ=';
  const malicious = {
    title: 'Отчёт клиента', subtitle: 'Публичный подзаголовок', unknownTop: 'secret',
    heroPhoto: photo,
    object: { pin: '1234', owner: 'Иван', address: 'Москва', internalFlag: true, source: 'CRM' },
    summary: { alarms: 2, incidents: 1, alarmsLabel: 'Тревоги', unknownSummary: 'secret' },
    events: [{ signal: 'Тревога', date: '21.10.2026', photo, sourceRows: [1], unknownEvent: true }],
    manager: { name: 'Анна', phone: '+7 900 000-00-00', photo, provenance: 'directory', unknownManager: true },
    promotions: [{ title: 'Скидка', description: 'Для клиента', image: photo, internalFlag: true }],
    proposal: {
      client: { name: 'ООО Клиент', phone: '+7 999 000-00-00', email: 'mail@example.test', internalId: 42 },
      scenario: { segment: 'B2B', region: 'Москва и МО, ЦФО', objectType: 'Офис', tariff: 'Бизнес-5000', rent: false, source: 'catalog' },
      items: [{
        system: 'hikvision', systemLabel: 'Охрана', code: '100118', name: 'Датчик', model: 'X', unit: 'компл.',
        quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
        sourceInstalledUnitPrice: 1200, priceOverridden: true, overrideReason: 'secret', sourceRows: [7], unknownItem: 'secret',
      }],
      selectedOptionNames: ['Техническое обслуживание'], discountPercent: 12.5,
      computed: {
        equipment: { subtotal: 3000, discountAmount: 375, afterDiscount: 2625, source: 'formula' },
        installation: { final: 5000, override: 1, overrideReason: 'secret' },
        oneTime: { final: 7625, unknownTotal: 1 },
        monthlyFee: { final: 2500 }, materialLiability: { final: 100000 },
        tariff: { resolvedName: 'Бизнес-5000', rawCatalog: { secret: true } },
        warnings: ['internal warning'], unknownComputed: true,
      },
      overrides: { installation: 1 }, rawCatalogs: [{ secret: true }], provenance: 'xlsx', unknownProposal: true,
    },
  };

  const created = await postJSON(port, '/api/reports', malicious);
  assert.equal(created.status, 200);
  const id = JSON.parse(created.body.toString('utf8')).id;

  const fetched = await request(port, '/api/reports/' + id);
  assert.equal(fetched.status, 200);
  const report = JSON.parse(fetched.body.toString('utf8'));

  assert.equal(report.title, malicious.title);
  assert.equal(report.heroPhoto, photo);
  assert.deepEqual(report.object, { pin: '1234', owner: 'Иван', address: 'Москва' });
  assert.equal(report.events[0].photo, photo);
  assert.equal(report.manager.photo, photo);
  assert.equal(report.promotions[0].image, photo);
  assert.deepEqual(report.proposal.items[0], {
    system: 'hikvision', systemLabel: 'Hikvision', code: '100118', name: 'Фотореле PMS, PR 601 2200Вт', model: 'Фотореле', unit: 'шт.',
    quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
  });
  assert.equal(report.proposal.computed.installation.final, 5000);
  assert.equal(report.proposal.computed.tariff.resolvedName, 'Бизнес-5000');
  assert.equal(report.proposal.discountPercent, 12.5);

  const serialized = JSON.stringify(report);
  for (const forbidden of [
    'unknownTop', 'unknownSummary', 'unknownEvent', 'unknownManager', 'internalFlag',
    'sourceRows', 'sourceInstalledUnitPrice', 'priceOverridden',
    'overrideReason', 'overrides', 'warnings', 'rawCatalog', 'rawCatalogs', 'provenance',
    'unknownItem', 'unknownComputed', 'unknownProposal', 'unknownTotal', 'internalId',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden + ' leaked into public JSON');

  malicious.proposal.discountPercent = -1;
  const invalidCreated = await postJSON(port, '/api/reports', malicious);
  assert.equal(invalidCreated.status, 422);
  const invalidBody = JSON.parse(invalidCreated.body.toString('utf8'));
  assert.ok(invalidBody.errors.some(error => error.path === 'proposal.discountPercent'));
});

test('POST reports rejects an invalid public proposal with structured 422 errors but allows legacy reports', async t => {
  const port = await startServer(t);
  const invalid = await postJSON(port, '/api/reports', {
    title: 'Invalid proposal',
    proposal: {
      client: { name: '' }, scenario: { segment: 'OTHER', region: '', objectType: '' },
      items: [{ code: '1', name: 'Датчик', quantity: 0, installedUnitPrice: 1000, lineTotal: 0 }],
      computed: { equipment: { afterDiscount: null }, installation: { final: null }, oneTime: { final: null }, monthlyFee: { final: null }, materialLiability: { final: null } },
    },
  });
  assert.equal(invalid.status, 422);
  const invalidBody = JSON.parse(invalid.body.toString('utf8'));
  assert.equal(invalidBody.error, 'invalid proposal');
  assert.ok(Array.isArray(invalidBody.errors));
  assert.ok(invalidBody.errors.some(error => error.path === 'proposal.client.name'));
  assert.ok(invalidBody.errors.some(error => error.path === 'proposal.scenario.segment'));
  assert.ok(invalidBody.errors.some(error => error.path === 'proposal.computed.monthlyFee.final'));

  const legacy = await postJSON(port, '/api/reports', { title: 'Legacy', events: [] });
  assert.equal(legacy.status, 200);
  const id = JSON.parse(legacy.body.toString('utf8')).id;
});

test('POST xlsx returns one workbook with RFC5987 filename for one system', async t => {
  const port = await startServer(t);
  const response = await postJSON(port, '/api/exports/xlsx', exportPayload([
    { system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', model: 'GSM-5', unit: 'шт.', quantity: 2, installedUnitPrice: 500 },
  ]));
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(response.headers['content-disposition'], /^attachment; filename="estimate\.xlsx"; filename\*=UTF-8''/);
  assert.equal(response.body.subarray(0, 2).toString(), 'PK');
  const strings = await workbookStrings(response.body);
  assert.match(strings, /РИТМ|R-1|Панель/);
  assert.doesNotMatch(strings, /sourceInstalledUnitPrice|overrideReason|provenance/);
});

test('POST xlsx derives unique system groups server-side and returns a ZIP with one correct workbook per system', async t => {
  const port = await startServer(t);
  const payload = exportPayload([
    { system: 'ritm', systemLabel: 'Охрана/Видео', code: 'R-1', name: 'Панель', quantity: 1, installedUnitPrice: 1000 },
    { system: 'hikvision', systemLabel: 'Охрана:Видео', code: 'H-1', name: 'Камера', quantity: 2, installedUnitPrice: 2000 },
  ]);
  payload.exportGroups = [{ id: 'evil', label: 'Подмена', items: payload.items }];
  const response = await postJSON(port, '/api/exports/xlsx', payload);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(response.headers['content-disposition'], /^attachment; filename="estimates\.zip"; filename\*=UTF-8''/);
  const archive = await unzipper.Open.buffer(response.body);
  assert.deepEqual(archive.files.map(file => file.path), [
    'Смета ООО Тест — ОхранаВидео.xlsx',
    'Смета ООО Тест — ОхранаВидео (2).xlsx',
  ]);
  const first = await workbookStrings(await archive.files[0].buffer());
  const second = await workbookStrings(await archive.files[1].buffer());
  assert.match(first, /R-1|Панель/);
  assert.doesNotMatch(first, /H-1|Камера|Подмена/);
  assert.match(second, /H-1|Камера/);
  assert.doesNotMatch(second, /R-1|Панель|Подмена/);
});

test('POST xlsx ZIP entry names stay unique under adversarial display-label collisions', async t => {
  const port = await startServer(t);
  const systems = ['ritm', 'si-nord', 'hikvision', 'rental-used', 'other'];
  const labels = ['Система', 'система', 'Система (2)', 'Система/Видео', 'Система:Видео'];
  const response = await postJSON(port, '/api/exports/xlsx', exportPayload(systems.map((system, index) => ({
    system, systemLabel: labels[index], code: 'C-' + index, name: 'Позиция ' + index, quantity: 1, installedUnitPrice: 100 + index,
  }))));
  assert.equal(response.status, 200);
  const archive = await unzipper.Open.buffer(response.body);
  const names = archive.files.map(file => file.path);
  const normalized = names.map(name => name.normalize('NFC').toLocaleLowerCase('ru'));
  assert.equal(names.length, systems.length);
  assert.equal(new Set(normalized).size, names.length);
  names.forEach(name => {
    assert.ok(name.endsWith('.xlsx'));
    assert.ok(Buffer.byteLength(name, 'utf8') <= 140, name);
  });
});

test('POST xlsx rejects unsafe, unknown and Unicode-lookalike system IDs', async t => {
  const port = await startServer(t);
  for (const system of ['', '../ritm', 'ritm/../hikvision', 'ritm\\evil', 'RITM', 'rіtm', 'ritm\n', 'unknown', 'si--nord']) {
    const response = await postJSON(port, '/api/exports/xlsx', exportPayload([
      { system, systemLabel: 'Display label', code: 'X-1', name: 'Позиция', quantity: 1, installedUnitPrice: 100 },
    ]));
    assert.equal(response.status, 422, JSON.stringify(system));
    assert.match(response.body.toString('utf8'), /system/i);
  }
});

test('POST xlsx rejects out-of-range numbers and unsafe line or accumulated totals', async t => {
  const port = await startServer(t);
  const base = { system: 'ritm', systemLabel: 'РИТМ', code: 'X-1', name: 'Позиция' };
  const cases = [
    [{ ...base, quantity: 1_000_001, installedUnitPrice: 1 }],
    [{ ...base, quantity: 1, installedUnitPrice: 1_000_000_000_001 }],
    [{ ...base, quantity: 1_000_000, installedUnitPrice: 1_000_000_000_000 }],
    [0, 1, 2].map(index => ({ ...base, code: 'S-' + index, quantity: 1_000_000, installedUnitPrice: 4_000_000_000 })),
  ];
  for (const items of cases) {
    const response = await postJSON(port, '/api/exports/xlsx', exportPayload(items));
    assert.equal(response.status, 422);
    assert.match(response.body.toString('utf8'), /quantity|price|total|safe/i);
  }
});

test('POST xlsx rejects malformed exports with structured 400 or 422 and does not crash', async t => {
  const port = await startServer(t);
  const invalid = await postJSON(port, '/api/exports/xlsx', exportPayload([
    { system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', quantity: 0, installedUnitPrice: 'NaN' },
  ]));
  assert.equal(invalid.status, 422);
  const body = JSON.parse(invalid.body.toString('utf8'));
  assert.equal(body.error, 'invalid export');
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors[0].path);
  const tooMany = await postJSON(port, '/api/exports/xlsx', exportPayload(Array.from({ length: 201 }, (_, index) => ({
    system: 'ritm', systemLabel: 'РИТМ', code: String(index), name: 'Позиция', quantity: 1, installedUnitPrice: 1,
  }))));
  assert.equal(tooMany.status, 422);
  assert.match(tooMany.body.toString('utf8'), /1\.\.200|200/);
  const after = await request(port, '/');
  assert.equal(after.status, 200);
});

test('POST pdf returns one branded PDF with RFC5987 filename for one system', async t => {
  const port = await startServer(t);
  const response = await postJSON(port, '/api/exports/pdf', exportPayload([
    { system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', quantity: 1, installedUnitPrice: 1000 },
  ]));
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.match(response.headers['content-disposition'], /^attachment; filename="proposal\.pdf"; filename\*=UTF-8''/);
  assert.equal(response.body.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('POST pdf derives groups server-side and returns one PDF per system in a ZIP', async t => {
  const port = await startServer(t);
  const payload = exportPayload([
    { system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', quantity: 1, installedUnitPrice: 1000 },
    { system: 'hikvision', systemLabel: 'ОхранаВидео', code: 'H-1', name: 'Камера', quantity: 1, installedUnitPrice: 2000 },
  ]);
  payload.exportGroups = [{ id: 'evil', label: 'Подмена' }];
  payload.rawCatalogs = [{ secret: true }];
  payload.overrideReason = 'secret';
  const response = await postJSON(port, '/api/exports/pdf', payload);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(response.headers['content-disposition'], /^attachment; filename="proposals\.zip"; filename\*=UTF-8''/);
  const archive = await unzipper.Open.buffer(response.body);
  assert.equal(archive.files.length, 2);
  archive.files.forEach(file => assert.ok(file.path.endsWith('.pdf')));
  for (const file of archive.files) assert.equal((await file.buffer()).subarray(0, 5).toString('ascii'), '%PDF-');
});

test('POST pdf rejects unsafe systems and invalid numeric totals without crashing', async t => {
  const port = await startServer(t);
  const unsafe = await postJSON(port, '/api/exports/pdf', exportPayload([
    { system: '../ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', quantity: 1, installedUnitPrice: 1000 },
  ]));
  assert.equal(unsafe.status, 422);
  const invalid = exportPayload([{ system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', quantity: 1, installedUnitPrice: 1000 }]);
  invalid.computed.monthlyFee.final = Infinity;
  const invalidResponse = await postJSON(port, '/api/exports/pdf', invalid);
  assert.equal(invalidResponse.status, 422);
  assert.match(invalidResponse.body.toString('utf8'), /monthlyFee|finite|amount/i);
  const overflow = exportPayload([{ system: 'ritm', systemLabel: 'РИТМ', code: 'MAX', name: 'Граница', quantity: 1, installedUnitPrice: 1_000_000_000_000 }]);
  overflow.discountPercent = 0;
  overflow.computed.installation.final = 0.01;
  const overflowResponse = await postJSON(port, '/api/exports/pdf', overflow);
  assert.equal(overflowResponse.status, 422);
  assert.match(overflowResponse.body.toString('utf8'), /oneTime|safe money limit/i);
  assert.equal((await request(port, '/')).status, 200);
});

test('POST pdf enforces its own small body limit', async t => {
  const port = await startServer(t);
  const payload = exportPayload([{ system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Панель', quantity: 1, installedUnitPrice: 1000 }]);
  payload.unusedPadding = 'x'.repeat(1024 * 1024);
  const response = await postJSON(port, '/api/exports/pdf', payload);
  assert.equal(response.status, 413);
});

test('POST pdf limits concurrent exports and advertises retry timing', async t => {
  const port = await startServer(t);
  const items = Array.from({ length: 200 }, (_, index) => ({
    system: 'ritm', systemLabel: 'РИТМ', code: 'R-' + index,
    name: 'Длинное наименование охранного оборудования ' + index,
    model: 'Модель ' + index, quantity: 1, installedUnitPrice: 1000,
  }));
  const responses = await Promise.all([0, 1, 2].map(() => postJSON(port, '/api/exports/pdf', exportPayload(items))));
  const busy = responses.filter(response => response.status === 503);
  assert.equal(busy.length, 1);
  assert.equal(busy[0].headers['retry-after'], '1');
  assert.equal(responses.filter(response => response.status === 200).length, 2);
});

test('aborted PDF export releases its concurrency slot', async t => {
  const port = await startServer(t);
  const items = Array.from({ length: 200 }, (_, index) => ({
    system: 'ritm', systemLabel: 'РИТМ', code: 'A-' + index,
    name: 'Оборудование ' + index, model: 'Модель ' + index,
    quantity: 1, installedUnitPrice: 1000,
  }));
  await abortPostJSON(port, '/api/exports/pdf', exportPayload(items));
  await new Promise(resolve => setTimeout(resolve, 1200));
  const responses = await Promise.all([0, 1].map(() => postJSON(port, '/api/exports/pdf', exportPayload(items.slice(0, 2)))));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 200]);
});
