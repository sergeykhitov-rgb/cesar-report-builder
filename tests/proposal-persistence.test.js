const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
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

function request(port, method, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks), headers: response.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function startServer(t) {
  const port = await freePort();
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cesar-proposal-reports-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), REPORTS_DIR: reportsDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(reportsDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 3000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return { port, reportsDir };
}

function validReport() {
  return {
    title: 'Коммерческое предложение',
    object: { pin: '1234', address: 'Москва, ул. Тестовая, 1' },
    manager: { name: 'Анна', role: 'Персональный менеджер', phone: '+7 900 000-00-00', email: 'manager@example.test' },
    promotions: [{ title: 'Выгодная предоплата', description: 'Скидка клиенту', image: '/promo.webp', priority: 1, source: 'internal' }],
    proposal: {
      client: { name: 'ООО Клиент', phone: '+7 999 000-00-00', email: 'client@example.test' },
      scenario: { segment: 'B2B', region: 'Москва', objectType: 'Офис', tariff: 'Бизнес', rent: false },
      items: [{
        system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Контрольная панель', model: 'GSM-5', unit: 'шт.',
        quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
        source: 'catalog.xlsx', sourceInstalledUnitPrice: 1200, overrideReason: 'manager', priceOverridden: true,
      }],
      selectedOptionNames: ['Тревожная кнопка'],
      discountPercent: 10,
      computed: {
        equipment: { subtotal: 3300, discountAmount: 300, afterDiscount: 3000, source: 'formula' },
        installation: { final: 5000, overrideReason: 'secret' },
        oneTime: { final: 8000 },
        monthlyFee: { final: 2500 },
        materialLiability: { final: 100000 },
        tariff: { resolvedName: 'Бизнес', rawCatalog: { secret: true } },
        warnings: [{ code: 'INTERNAL', message: 'hidden' }],
        internalPricingMetadata: { margin: 42 },
      },
      rawCatalogs: [{ secret: true }],
    },
  };
}

function renderPublicReport(report) {
  const context = { window: {}, globalThis: {} };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'report-render.js'), 'utf8'), context);
  return context.renderReport(report);
}

test('POST /api/reports persists a normalized public proposal snapshot and exposes only client values', async t => {
  const { port, reportsDir } = await startServer(t);
  const created = await request(port, 'POST', '/api/reports', validReport());
  assert.equal(created.status, 200);
  const id = JSON.parse(created.body.toString()).id;
  const files = fs.readdirSync(reportsDir);
  assert.deepEqual(files, [`${id}.json`]);

  const stored = JSON.parse(fs.readFileSync(path.join(reportsDir, `${id}.json`), 'utf8'));
  const fetchedResponse = await request(port, 'GET', `/api/reports/${id}`);
  assert.equal(fetchedResponse.status, 200);
  const fetched = JSON.parse(fetchedResponse.body.toString());
  assert.deepEqual(fetched, stored);

  assert.deepEqual(stored.proposal.items[0], {
    system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Контрольная панель', model: 'GSM-5', unit: 'шт.',
    quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
  });
  assert.equal(stored.proposal.computed.equipment.afterDiscount, 3000);
  assert.equal(stored.proposal.computed.oneTime.final, 8000);
  assert.equal(stored.proposal.computed.monthlyFee.final, 2500);
  assert.deepEqual(stored.proposal.selectedOptionNames, ['Тревожная кнопка']);
  assert.equal(stored.promotions[0].title, 'Выгодная предоплата');
  assert.equal(stored.manager.phone, '+7 900 000-00-00');

  const serializedSurfaces = [JSON.stringify(stored), fetchedResponse.body.toString(), renderPublicReport(fetched)].join('\n');
  for (const forbidden of [
    '"source"', 'sourceInstalledUnitPrice', 'overrideReason', 'priceOverridden', 'rawCatalog', 'rawCatalogs',
    'warnings', 'internalPricingMetadata', 'catalog.xlsx',
  ]) {
    assert.equal(serializedSurfaces.includes(forbidden), false, `${forbidden} leaked`);
  }
  const html = renderPublicReport(fetched);
  assert.match(html, /ООО Клиент/);
  assert.match(html, /Контрольная панель/);
  assert.match(html, /8[\s\u00a0]?000/);
  assert.match(html, /Тревожная кнопка/);
  assert.match(html, /Выгодная предоплата/);
  assert.match(html, /\+7 900 000-00-00/);
});

test('POST /api/reports rejects oversized proposal item arrays instead of truncating them', async t => {
  const { port, reportsDir } = await startServer(t);
  const payload = validReport();
  payload.proposal.items = Array.from({ length: 201 }, (_, index) => ({
    ...payload.proposal.items[0], code: `R-${index}`, lineTotal: 1500,
  }));
  const response = await request(port, 'POST', '/api/reports', payload);
  assert.equal(response.status, 422);
  const body = JSON.parse(response.body.toString());
  assert.ok(body.errors.some(error => error.path === 'proposal.items'));
  assert.deepEqual(fs.readdirSync(reportsDir), []);
});

test('POST /api/reports enforces strict proposal types, bounds and known system ids', async t => {
  const { port, reportsDir } = await startServer(t);
  const mutations = [
    payload => { payload.proposal.items = 'not-an-array'; },
    payload => { payload.proposal.items[0].quantity = '2'; },
    payload => { payload.proposal.items[0].system = 'unknown-system'; },
    payload => { payload.proposal.items[0].name = 'X'.repeat(501); },
    payload => { payload.proposal.items[0].installedUnitPrice = 1e13; payload.proposal.items[0].lineTotal = 1e13; },
    payload => { payload.proposal.selectedOptionNames = ['X'.repeat(501)]; },
  ];
  for (const mutate of mutations) {
    const payload = validReport();
    mutate(payload);
    const response = await request(port, 'POST', '/api/reports', payload);
    assert.equal(response.status, 422, response.body.toString());
  }
  assert.deepEqual(fs.readdirSync(reportsDir), []);
});

test('POST /api/reports continues to accept legacy reports without proposal', async t => {
  const { port, reportsDir } = await startServer(t);
  const response = await request(port, 'POST', '/api/reports', { title: 'Старый отчёт', events: [] });
  assert.equal(response.status, 200);
  const id = JSON.parse(response.body.toString()).id;
  const stored = JSON.parse(fs.readFileSync(path.join(reportsDir, `${id}.json`), 'utf8'));
  assert.equal(stored.title, 'Старый отчёт');
  assert.equal(Object.hasOwn(stored, 'proposal'), false);
});
