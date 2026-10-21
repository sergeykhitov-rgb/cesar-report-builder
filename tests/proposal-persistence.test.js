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

async function startServer(t, options = {}) {
  const port = await freePort();
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cesar-proposal-reports-'));
  for (const [name, contents] of Object.entries(options.preseed || {})) fs.writeFileSync(path.join(reportsDir, name), contents);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), REPORTS_DIR: reportsDir, ...(options.env || {}) },
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
      scenario: { segment: 'B2B', region: 'Москва и МО, ЦФО', objectType: 'Офис', tariff: 'Бизнес-5000', rent: false },
      items: [{
        system: 'hikvision', systemLabel: 'Подменённая система', code: '100118', name: 'Подменённое название', model: 'Подмена', unit: 'компл.',
        quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
        source: 'catalog.xlsx', sourceInstalledUnitPrice: 1200, overrideReason: 'manager', priceOverridden: true,
      }],
      selectedOptionNames: ['Техническое обслуживание'],
      discountPercent: 10,
      computed: {
        equipment: { subtotal: 3000, discountAmount: 300, afterDiscount: 2700, source: 'formula' },
        installation: { final: 5000, overrideReason: 'secret' },
        oneTime: { final: 7700 },
        monthlyFee: { final: 2500 },
        materialLiability: { final: 100000 },
        tariff: { resolvedName: 'Бизнес-5000', rawCatalog: { secret: true } },
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
    system: 'hikvision', systemLabel: 'Hikvision', code: '100118', name: 'Фотореле PMS, PR 601 2200Вт', model: 'Фотореле', unit: 'шт.',
    quantity: 2, installedUnitPrice: 1500, lineTotal: 3000,
  });
  assert.equal(stored.proposal.computed.equipment.afterDiscount, 2700);
  assert.equal(stored.proposal.computed.oneTime.final, 7700);
  assert.equal(stored.proposal.computed.monthlyFee.final, 2500);
  assert.deepEqual(stored.proposal.selectedOptionNames, ['Техническое обслуживание']);
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
  assert.match(html, /Фотореле PMS/);
  assert.match(html, /7[\s\u00a0]?700/);
  assert.match(html, /Техническое обслуживание/);
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

test('POST /api/reports rejects adversarial catalog, arithmetic, option and tariff mismatches without writing', async t => {
  const { port, reportsDir } = await startServer(t);
  const mutations = [
    payload => { payload.proposal.items[0].code = 'does-not-exist'; },
    payload => { payload.proposal.items[0].lineTotal = 2999.99; },
    payload => { payload.proposal.computed.equipment.subtotal = 2999.99; },
    payload => { payload.proposal.computed.equipment.discountAmount = 299.99; },
    payload => { payload.proposal.computed.equipment.afterDiscount = 2700.01; },
    payload => { payload.proposal.computed.oneTime.final = 7700.01; },
    payload => { payload.proposal.selectedOptionNames = ['Видеокамера для Cesar Home']; },
    payload => { payload.proposal.computed.tariff.resolvedName = 'Несуществующий тариф'; },
  ];
  for (const mutate of mutations) {
    const payload = validReport();
    mutate(payload);
    const response = await request(port, 'POST', '/api/reports', payload);
    assert.equal(response.status, 422, response.body.toString());
    const body = JSON.parse(response.body.toString());
    assert.equal(body.error, 'invalid proposal');
    assert.ok(body.errors.length > 0);
  }
  assert.deepEqual(fs.readdirSync(reportsDir), []);
});

test('POST /api/reports preserves manual final overrides when public arithmetic remains consistent', async t => {
  const { port } = await startServer(t);
  const payload = validReport();
  payload.proposal.items[0].installedUnitPrice = 1777.77;
  payload.proposal.items[0].lineTotal = 3555.54;
  payload.proposal.computed.equipment = { subtotal: 3555.54, discountAmount: 355.55, afterDiscount: 3199.99 };
  payload.proposal.computed.installation.final = 4321.09;
  payload.proposal.computed.oneTime.final = 7521.08;
  payload.proposal.computed.monthlyFee.final = 1234.56;
  payload.proposal.computed.materialLiability.final = 98765.43;
  const response = await request(port, 'POST', '/api/reports', payload);
  assert.equal(response.status, 200, response.body.toString());
});

test('POST /api/reports verifies monetary consistency with decimal half-up rounding', async t => {
  const { port } = await startServer(t);
  const payload = validReport();
  payload.proposal.items[0].quantity = 1;
  payload.proposal.items[0].installedUnitPrice = 0.105;
  payload.proposal.items[0].lineTotal = 0.11;
  payload.proposal.computed.equipment = { subtotal: 0.11, discountAmount: 0.01, afterDiscount: 0.10 };
  payload.proposal.computed.installation.final = 0;
  payload.proposal.computed.oneTime.final = 0.10;
  const response = await request(port, 'POST', '/api/reports', payload);
  assert.equal(response.status, 200, response.body.toString());

  const multiplied = validReport();
  multiplied.proposal.items[0].quantity = 2;
  multiplied.proposal.items[0].installedUnitPrice = 0.105;
  multiplied.proposal.items[0].lineTotal = 0.21;
  multiplied.proposal.computed.equipment = { subtotal: 0.21, discountAmount: 0.02, afterDiscount: 0.19 };
  multiplied.proposal.computed.installation.final = 0;
  multiplied.proposal.computed.oneTime.final = 0.19;
  const multipliedResponse = await request(port, 'POST', '/api/reports', multiplied);
  assert.equal(multipliedResponse.status, 200, multipliedResponse.body.toString());
});

test('POST /api/reports accepts a catalog-valid B2C rental video transition', async t => {
  const { port } = await startServer(t);
  const payload = validReport();
  payload.proposal.scenario = { segment: 'B2C', region: 'Москва/МО, ЦФО', objectType: 'Квартира', tariff: 'Базовый', rent: true };
  payload.proposal.selectedOptionNames = [];
  payload.proposal.computed.tariff.resolvedName = 'Видео Базовый';
  const response = await request(port, 'POST', '/api/reports', payload);
  assert.equal(response.status, 200, response.body.toString());
});

test('POST /api/reports retries deterministic id collisions and atomically preserves the existing report', async t => {
  const collision = '{"id":"aaaaaaaaaaaa","title":"Не перезаписывать"}';
  const { port, reportsDir } = await startServer(t, {
    preseed: { 'aaaaaaaaaaaa.json': collision },
    env: { REPORT_ID_SEQUENCE: 'aaaaaaaaaaaa,bbbbbbbbbbbb' },
  });
  const response = await request(port, 'POST', '/api/reports', validReport());
  assert.equal(response.status, 200, response.body.toString());
  assert.equal(JSON.parse(response.body.toString()).id, 'bbbbbbbbbbbb');
  assert.equal(fs.readFileSync(path.join(reportsDir, 'aaaaaaaaaaaa.json'), 'utf8'), collision);
  assert.ok(fs.existsSync(path.join(reportsDir, 'bbbbbbbbbbbb.json')));
  assert.deepEqual(fs.readdirSync(reportsDir).sort(), ['aaaaaaaaaaaa.json', 'bbbbbbbbbbbb.json']);
});

test('POST /api/reports rejects oversized report fields and collections but accepts separately bounded images', async t => {
  const { port, reportsDir } = await startServer(t);
  const mutations = [
    payload => { payload.title = 'X'.repeat(501); },
    payload => { payload.object.address = 'X'.repeat(2001); },
    payload => { payload.events = Array.from({ length: 201 }, () => ({})); },
    payload => { payload.events = [{ note: 'X'.repeat(5001) }]; },
    payload => { payload.manager.name = 'X'.repeat(501); },
    payload => { payload.promotions = Array.from({ length: 101 }, () => ({ title: 'Акция' })); },
    payload => { payload.promotions[0].description = 'X'.repeat(5001); },
    payload => { payload.heroPhoto = 'data:image/png;base64,' + 'A'.repeat(10 * 1024 * 1024 + 1); },
  ];
  for (const mutate of mutations) {
    const payload = validReport();
    mutate(payload);
    const response = await request(port, 'POST', '/api/reports', payload);
    assert.equal(response.status, 422, response.body.toString());
  }
  assert.deepEqual(fs.readdirSync(reportsDir), []);

  const withImage = validReport();
  withImage.heroPhoto = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
  const accepted = await request(port, 'POST', '/api/reports', withImage);
  assert.equal(accepted.status, 200, accepted.body.toString());
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
