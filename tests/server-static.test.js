const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

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
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function startServer(t) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
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
      scenario: { segment: 'B2B', region: 'Москва', objectType: 'Офис', tariff: 'Бизнес', rent: false, source: 'catalog' },
      items: [{
        system: 'security', systemLabel: 'Охрана', code: 'A-1', name: 'Датчик', model: 'X', unit: 'шт.',
        quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
        sourceInstalledUnitPrice: 1200, priceOverridden: true, overrideReason: 'secret', sourceRows: [7], unknownItem: 'secret',
      }],
      selectedOptionNames: ['Реагирование'],
      computed: {
        equipment: { subtotal: 3200, discountAmount: 200, afterDiscount: 3000, source: 'formula' },
        installation: { final: 5000, override: 1, overrideReason: 'secret' },
        oneTime: { final: 8000, unknownTotal: 1 },
        monthlyFee: { final: 2500 }, materialLiability: { final: 100000 },
        tariff: { resolvedName: 'Бизнес', rawCatalog: { secret: true } },
        warnings: ['internal warning'], unknownComputed: true,
      },
      overrides: { installation: 1 }, rawCatalogs: [{ secret: true }], provenance: 'xlsx', unknownProposal: true,
    },
  };

  const created = await postJSON(port, '/api/reports', malicious);
  assert.equal(created.status, 200);
  const id = JSON.parse(created.body.toString('utf8')).id;
  t.after(() => require('node:fs').rmSync(path.join(ROOT, 'data', 'reports', id + '.json'), { force: true }));

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
    system: 'security', systemLabel: 'Охрана', code: 'A-1', name: 'Датчик', model: 'X', unit: 'шт.',
    quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
  });
  assert.equal(report.proposal.computed.installation.final, 5000);
  assert.equal(report.proposal.computed.tariff.resolvedName, 'Бизнес');

  const serialized = JSON.stringify(report);
  for (const forbidden of [
    'unknownTop', 'unknownSummary', 'unknownEvent', 'unknownManager', 'internalFlag',
    'sourceRows', 'sourceInstalledUnitPrice', 'priceOverridden',
    'overrideReason', 'overrides', 'warnings', 'rawCatalog', 'rawCatalogs', 'provenance',
    'unknownItem', 'unknownComputed', 'unknownProposal', 'unknownTotal', 'internalId',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden + ' leaked into public JSON');
});
