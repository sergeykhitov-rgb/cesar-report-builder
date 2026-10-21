const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PRIORITY_IDS = ['two-objects', 'refer-friend', 'prepayment'];

function loadBrowserScript(relativePath, context = {}) {
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context);
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPromotions() {
  return loadBrowserScript('public/promotions.js');
}

function loadState() {
  delete require.cache[require.resolve('../public/calculator.js')];
  return require('../public/calculator.js');
}

function catalogs() {
  return {
    ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogs/calculator.json'), 'utf8')),
    equipment: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogs/equipment.json'), 'utf8')),
  };
}

test('default proposal has an explicit schema and returns independent deep clones', () => {
  const state = loadState();
  const first = state.createDefaultProposal();
  const second = state.createDefaultProposal();

  assert.deepEqual(Object.keys(first), [
    'schemaVersion', 'client', 'scenario', 'items', 'selectedOptionNames',
    'discountPercent', 'counts', 'overrides', 'computed', 'exportMetadata',
  ]);
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first.client, { name: '', phone: '', email: '' });
  assert.deepEqual(first.scenario, {
    segment: 'B2C', region: 'Москва/МО, ЦФО', objectType: 'Квартира', tariff: 'Базовый', rent: false,
    baseMonthlyFee: null, installationCalculated: null,
  });
  assert.deepEqual(first.items, []);
  assert.deepEqual(first.selectedOptionNames, []);
  assert.deepEqual(first.counts, {
    cameraCount: 0, additionalHouseholdSensors: 0, additionalSecuritySensors: 0, baseSecuritySensorCount: 0,
  });
  assert.deepEqual(first.overrides, {
    monthlyFeeOverride: null, installationOverride: null, materialLiabilityOverride: null,
  });
  assert.deepEqual(first.exportMetadata, { generatedAt: null, generatedBy: null });

  first.client.name = 'Изменено';
  first.items.push({ code: 'x' });
  first.counts.cameraCount = 3;
  assert.equal(second.client.name, '');
  assert.deepEqual(second.items, []);
  assert.equal(second.counts.cameraCount, 0);
});

test('legacy draft migration adds proposal without losing report fields', () => {
  const state = loadState();
  const legacy = { title: 'Старый отчёт', object: { pin: '123' }, events: [{ note: 'Сохранить' }], promotions: [] };
  const migrated = state.ensureDraft(legacy, { isNewDraft: false });

  assert.equal(migrated.title, 'Старый отчёт');
  assert.equal(migrated.object.pin, '123');
  assert.equal(migrated.events[0].note, 'Сохранить');
  assert.deepEqual(migrated.promotions, []);
  assert.equal(migrated.proposal.schemaVersion, 1);
});

test('malformed proposal collections and records normalize to safe shapes', () => {
  const state = loadState();
  const normalized = state.normalizeProposal({
    client: null,
    scenario: [],
    items: { bad: true },
    selectedOptionNames: 'camera',
    counts: null,
    overrides: [],
    computed: [],
    exportMetadata: 'bad',
  });

  assert.deepEqual(normalized.client, { name: '', phone: '', email: '' });
  assert.equal(Array.isArray(normalized.items), true);
  assert.deepEqual(normalized.items, []);
  assert.deepEqual(normalized.selectedOptionNames, []);
  assert.deepEqual(normalized.counts, {
    cameraCount: 0, additionalHouseholdSensors: 0, additionalSecuritySensors: 0, baseSecuritySensorCount: 0,
  });
  assert.deepEqual(normalized.overrides, {
    monthlyFeeOverride: null, installationOverride: null, materialLiabilityOverride: null,
  });
  assert.equal(normalized.computed, null);
  assert.deepEqual(normalized.exportMetadata, { generatedAt: null, generatedBy: null });
});

test('malformed item entries are discarded before calculation', () => {
  const state = loadState();
  const proposal = state.normalizeProposal({
    items: [null, 'bad', { code: 'valid', quantity: 0, installedUnitPrice: 100 }],
  });

  assert.deepEqual(proposal.items, [{ code: 'valid', quantity: 0, installedUnitPrice: 100 }]);
  assert.doesNotThrow(() => state.calculateProposal(proposal, catalogs()));
});

test('nested proposal fields are sanitized by explicit type rules', () => {
  const state = loadState();
  const normalized = state.normalizeProposal({
    client: { name: null, phone: 123, email: 'client@example.test', ignored: 'drop' },
    scenario: {
      segment: 'consumer',
      region: null,
      objectType: ['Квартира'],
      tariff: 'Выгодный',
      rent: 'yes',
      baseMonthlyFee: '5000',
      installationCalculated: Infinity,
      ignored: true,
    },
    items: [
      {
        code: 'A', quantity: 2, installedUnitPrice: 100.5, active: true, note: null,
        invalidNumber: Infinity, nested: { unsafe: true }, list: ['unsafe'], missing: undefined,
      },
      new Date(),
    ],
    selectedOptionNames: ['Кнопка', null, 'Кнопка', 'Камера', 7, 'Камера'],
    discountPercent: '5',
    counts: {
      cameraCount: 'bad',
      additionalHouseholdSensors: 2,
      additionalSecuritySensors: NaN,
      baseSecuritySensorCount: 1.5,
    },
    overrides: {
      monthlyFeeOverride: {},
      installationOverride: false,
      materialLiabilityOverride: '0',
    },
    exportMetadata: { generatedAt: 123, generatedBy: 'manager', ignored: {} },
  });

  assert.deepEqual(normalized.client, { name: '', phone: '', email: 'client@example.test' });
  assert.deepEqual(normalized.scenario, {
    segment: 'B2C', region: 'Москва/МО, ЦФО', objectType: 'Квартира', tariff: 'Выгодный', rent: false,
    baseMonthlyFee: null, installationCalculated: null,
  });
  assert.deepEqual(normalized.items, [{ code: 'A', quantity: 2, installedUnitPrice: 100.5, active: true, note: null }]);
  assert.deepEqual(normalized.selectedOptionNames, ['Кнопка', 'Камера']);
  assert.equal(normalized.discountPercent, 5);
  assert.deepEqual(normalized.counts, {
    cameraCount: 0, additionalHouseholdSensors: 2, additionalSecuritySensors: 0, baseSecuritySensorCount: 1.5,
  });
  assert.deepEqual(normalized.overrides, {
    monthlyFeeOverride: null, installationOverride: null, materialLiabilityOverride: '0',
  });
  assert.deepEqual(normalized.exportMetadata, { generatedAt: null, generatedBy: 'manager' });
});

test('valid B2B scenario and override zero forms survive normalization', () => {
  const state = loadState();
  const normalized = state.normalizeProposal({
    scenario: { segment: 'B2B', region: 'СЗФО', objectType: '', tariff: 'Бизнес-4300', rent: true },
    discountPercent: 5,
    overrides: { monthlyFeeOverride: 0, installationOverride: '', materialLiabilityOverride: ' 12.5 ' },
  });

  assert.deepEqual(normalized.scenario, {
    segment: 'B2B', region: 'СЗФО', objectType: '', tariff: 'Бизнес-4300', rent: true,
    baseMonthlyFee: null, installationCalculated: null,
  });
  assert.equal(normalized.discountPercent, 5);
  assert.deepEqual(normalized.overrides, {
    monthlyFeeOverride: 0, installationOverride: '', materialLiabilityOverride: '12.5',
  });
});

test('numeric HTML input strings normalize for counts and discount while invalid strings use defaults', () => {
  const state = loadState();
  const normalized = state.normalizeProposal({
    discountPercent: '0',
    counts: {
      cameraCount: '3',
      additionalHouseholdSensors: ' 2 ',
      additionalSecuritySensors: '',
      baseSecuritySensorCount: 'not-a-number',
    },
  });

  assert.equal(normalized.discountPercent, 0);
  assert.deepEqual(normalized.counts, {
    cameraCount: 3, additionalHouseholdSensors: 2, additionalSecuritySensors: 0, baseSecuritySensorCount: 0,
  });
  assert.equal(state.normalizeProposal({ discountPercent: '5' }).discountPercent, 5);
  assert.equal(state.normalizeProposal({ discountPercent: 'bad' }).discountPercent, 0);
});

test('schema migration accepts missing and older versions but rejects future versions', () => {
  const state = loadState();

  assert.equal(state.normalizeProposal({ client: { name: 'Legacy' } }).schemaVersion, 1);
  assert.equal(state.normalizeProposal({ schemaVersion: 0, client: { name: 'Older' } }).schemaVersion, 1);
  assert.equal(state.normalizeProposal({ schemaVersion: 1 }).schemaVersion, 1);
  assert.throws(
    () => state.normalizeProposal({ schemaVersion: 2 }),
    error => error.code === 'UNSUPPORTED_PROPOSAL_SCHEMA' && /Unsupported proposal schema version: 2/.test(error.message)
  );
});

test('priority promotions are selected only for a new draft and copy all catalog fields', () => {
  const promotionContext = loadPromotions();
  global.CESAR_PROMOTIONS = promotionContext.CESAR_PROMOTIONS;
  global.CESAR_PRIORITY_PROMOTIONS = promotionContext.CESAR_PRIORITY_PROMOTIONS;
  const state = loadState();

  const fresh = state.ensureDraft({}, { isNewDraft: true });
  assert.deepEqual(plain(fresh.promotions.map(item => item.id)), PRIORITY_IDS);
  fresh.promotions.forEach(item => assert.deepEqual(Object.keys(item), ['id', 'title', 'description', 'image', 'priority']));

  const explicitEmpty = state.ensureDraft({ promotions: [] }, { isNewDraft: false });
  assert.deepEqual(explicitEmpty.promotions, []);
  delete global.CESAR_PROMOTIONS;
  delete global.CESAR_PRIORITY_PROMOTIONS;
});

test('promotion priority contract is exact, numeric, and picker order is stable', () => {
  const context = loadPromotions();
  assert.deepEqual(plain(context.CESAR_PRIORITY_PROMOTIONS), PRIORITY_IDS);
  context.CESAR_PROMOTIONS.forEach(item => assert.equal(typeof item.priority, 'number', item.id));

  const sorted = context.CESAR_PROMOTIONS
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.priority - a.item.priority || a.index - b.index)
    .map(entry => entry.item.id);
  assert.deepEqual(plain(sorted.slice(0, 3)), PRIORITY_IDS);
});

test('deselected default stays absent when an existing draft is normalized again', () => {
  const promotionContext = loadPromotions();
  global.CESAR_PROMOTIONS = promotionContext.CESAR_PROMOTIONS;
  global.CESAR_PRIORITY_PROMOTIONS = promotionContext.CESAR_PRIORITY_PROMOTIONS;
  const state = loadState();
  const fresh = state.ensureDraft({}, { isNewDraft: true });
  fresh.promotions = fresh.promotions.filter(item => item.id !== 'refer-friend');

  const reloaded = state.ensureDraft(plain(fresh), { isNewDraft: false });
  assert.deepEqual(reloaded.promotions.map(item => item.id), ['two-objects', 'prepayment']);
  delete global.CESAR_PROMOTIONS;
  delete global.CESAR_PRIORITY_PROMOTIONS;
});

test('calculation updates the computed snapshot from normalized proposal input', () => {
  const state = loadState();
  const proposal = state.createDefaultProposal();
  proposal.counts.cameraCount = 3;

  const updated = state.calculateProposal(proposal, catalogs());
  assert.strictEqual(updated, proposal);
  assert.equal(proposal.computed.tariff.resolvedName, 'Видео Базовый');
  assert.equal(proposal.computed.monthlyFee.final, 2800);
});

test('reset override clears and recalculates all three supported fields', () => {
  const state = loadState();
  global.CESAR_CALCULATOR_CATALOGS = catalogs();
  const cases = [
    ['monthlyFeeOverride', 'monthlyFee'],
    ['installationOverride', 'installation'],
    ['materialLiabilityOverride', 'materialLiability'],
  ];

  cases.forEach(([field, computedField]) => {
    const proposal = state.createDefaultProposal();
    proposal.overrides[field] = 123;
    state.calculateProposal(proposal, catalogs());
    assert.equal(proposal.computed[computedField].overridden, true, field);
    state.resetOverride(proposal, field);
    assert.equal(proposal.overrides[field], null, field);
    assert.equal(proposal.computed[computedField].overridden, false, field);
  });
  delete global.CESAR_CALCULATOR_CATALOGS;
});

test('reset override rejects unsupported fields without mutating proposal', () => {
  const state = loadState();
  const proposal = state.createDefaultProposal();
  const before = structuredClone(proposal);

  assert.throws(() => state.resetOverride(proposal, 'unknownOverride'), /unknownOverride/);
  assert.deepEqual(proposal, before);
});

test('generated browser catalogs exactly match sources and builder output is deterministic', () => {
  const sourceCalculator = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogs/calculator.json'), 'utf8'));
  const sourceEquipment = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogs/equipment.json'), 'utf8'));
  const generatedContext = loadBrowserScript('public/calculator-catalogs.js');
  assert.deepEqual(plain(generatedContext.CESAR_CALCULATOR_CATALOGS), {
    calculator: sourceCalculator,
    equipment: sourceEquipment,
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cesar-calculator-catalogs-'));
  const first = path.join(tempDir, 'first.js');
  const second = path.join(tempDir, 'second.js');
  execFileSync(process.execPath, ['scripts/build-calculator-catalogs.js', first], { cwd: ROOT });
  execFileSync(process.execPath, ['scripts/build-calculator-catalogs.js', second], { cwd: ROOT });
  assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8'));
  assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(path.join(ROOT, 'public/calculator-catalogs.js'), 'utf8'));
  assert.equal(fs.readFileSync(first, 'utf8').trim().split('\n').length, 1);
});

test('generated browser catalogs recursively freeze nested records and arrays', () => {
  const generatedContext = loadBrowserScript('public/calculator-catalogs.js');
  const payload = generatedContext.CESAR_CALCULATOR_CATALOGS;
  const firstTariff = payload.calculator.b2bTariffs[0];

  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.calculator), true);
  assert.equal(Object.isFrozen(payload.calculator.b2bTariffs), true);
  assert.equal(Object.isFrozen(firstTariff), true);
  assert.equal(Object.isFrozen(firstTariff.source), true);
  assert.throws(() => payload.calculator.b2bTariffs.push({}), /object is not extensible/);
  const originalRegion = firstTariff.region;
  firstTariff.region = 'mutated';
  assert.equal(firstTariff.region, originalRegion);
});

test('index loads calculator dependencies before renderer and editor', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(scripts.slice(-6), [
    '/promotions.js',
    '/calculator-catalogs.js',
    '/calculator-engine.js',
    '/calculator.js',
    '/report-render.js',
    '/editor.js',
  ]);
});
