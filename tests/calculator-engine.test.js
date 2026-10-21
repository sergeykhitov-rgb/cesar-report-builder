const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const catalogs = JSON.parse(fs.readFileSync('data/catalogs/calculator.json', 'utf8'));

function engine() {
  return require('../public/calculator-engine.js');
}

function input(overrides = {}) {
  return {
    segment: 'B2C',
    region: 'Москва/МО, ЦФО',
    objectType: 'Квартира',
    tariff: 'Базовый',
    rent: false,
    items: [],
    selectedOptionNames: [],
    discountPercent: 0,
    ...overrides,
  };
}

test('calculates equipment line totals and an allowed discount to kopecks', () => {
  const result = engine().calculate(input({
    discountPercent: 5,
    items: [
      { system: 'ritm', systemLabel: 'Ритм', code: 'A', name: 'A', model: '', unit: 'шт.', quantity: 2, installedUnitPrice: 100.15 },
      { system: 'ritm', systemLabel: 'Ритм', code: 'B', name: 'B', model: '', unit: 'шт.', quantity: 0, installedUnitPrice: 999 },
      { system: 'hikvision', systemLabel: 'Hikvision', code: 'C', name: 'C', model: '', unit: 'шт.', quantity: 1, installedUnitPrice: 99.7 },
    ],
    installationCalculated: 500,
  }), catalogs);

  assert.deepEqual(result.equipment.items.map(item => item.lineTotal), [200.3, 99.7]);
  assert.equal(result.equipment.subtotal, 300);
  assert.equal(result.equipment.discountAmount, 15);
  assert.equal(result.equipment.afterDiscount, 285);
  assert.equal(result.oneTime.final, 785);
});

test('manual numeric zero overrides monthly fee, installation, and liability', () => {
  const result = engine().calculate(input({
    installationCalculated: 5000,
    monthlyFeeOverride: 0,
    installationOverride: 0,
    materialLiabilityOverride: 0,
  }), catalogs);

  assert.deepEqual(result.monthlyFee, { calculated: 1990, override: 0, final: 0, overridden: true, base: 1990, options: 0, rentalAdjustments: 0 });
  assert.equal(result.installation.final, 0);
  assert.equal(result.materialLiability.final, 0);
  assert.equal(result.oneTime.final, 0);
});

test('invalid override produces a warning and never NaN or silent zero', () => {
  const result = engine().calculate(input({ monthlyFeeOverride: '-oops' }), catalogs);

  assert.equal(result.monthlyFee.final, null);
  assert.equal(result.monthlyFee.overridden, false);
  assert.ok(result.warnings.some(warning => warning.code === 'INVALID_OVERRIDE' && warning.field === 'monthlyFeeOverride'));
  assert.equal(Number.isNaN(result.monthlyFee.final), false);
});

test('camera changes B2C tariff and three cameras charge only two extras', () => {
  const result = engine().calculate(input({ cameraCount: 3 }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Видео Базовый');
  assert.equal(result.monthlyFee.base, 2300);
  assert.equal(result.monthlyFee.rentalAdjustments, 500);
  assert.equal(result.monthlyFee.final, 2800);
});

test('apartment Basic security threshold changes only above three extra sensors', () => {
  assert.equal(engine().calculate(input({ additionalSecuritySensors: 3 }), catalogs).tariff.resolvedName, 'Базовый');
  assert.equal(engine().calculate(input({ additionalSecuritySensors: 4 }), catalogs).tariff.resolvedName, 'Премиальный');
});

test('apartment Value security threshold changes only above two extra sensors', () => {
  assert.equal(engine().calculate(input({ tariff: 'Выгодный', additionalSecuritySensors: 2 }), catalogs).tariff.resolvedName, 'Выгодный');
  assert.equal(engine().calculate(input({ tariff: 'Выгодный', additionalSecuritySensors: 3 }), catalogs).tariff.resolvedName, 'Премиальный');
});

test('house Basic and Value security threshold changes only above four extra sensors', () => {
  const house = { objectType: 'Дом' };
  assert.equal(engine().calculate(input({ ...house, additionalSecuritySensors: 4 }), catalogs).tariff.resolvedName, 'Базовый');
  assert.equal(engine().calculate(input({ ...house, additionalSecuritySensors: 5 }), catalogs).tariff.resolvedName, 'Премиальный');
  assert.equal(engine().calculate(input({ ...house, tariff: 'Выгодный', additionalSecuritySensors: 4 }), catalogs).tariff.resolvedName, 'Выгодный');
  assert.equal(engine().calculate(input({ ...house, tariff: 'Выгодный', additionalSecuritySensors: 5 }), catalogs).tariff.resolvedName, 'Премиальный');
});

test('household sensor promotes Basic to Value while Premium stays Premium', () => {
  assert.equal(engine().calculate(input({ additionalHouseholdSensors: 1 }), catalogs).tariff.resolvedName, 'Выгодный');
  assert.equal(engine().calculate(input({ tariff: 'Премиальный', additionalHouseholdSensors: 9, additionalSecuritySensors: 9 }), catalogs).tariff.resolvedName, 'Премиальный');
});

test('B2B rent increases a supplied 5000 base tariff by 15 percent', () => {
  const result = engine().calculate(input({
    segment: 'B2B', region: 'Москва и МО, ЦФО', objectType: '', tariff: '', rent: true, baseMonthlyFee: 5000,
  }), catalogs);

  assert.equal(result.monthlyFee.base, 5000);
  assert.equal(result.monthlyFee.rentalAdjustments, 750);
  assert.equal(result.monthlyFee.final, 5750);
});

test('B2B rental installation defaults to 5000 and warns below minimum', () => {
  const defaults = engine().calculate(input({ segment: 'B2B', region: 'СЗФО', objectType: '', tariff: 'Бизнес-4300', rent: true }), catalogs);
  const below = engine().calculate(input({ segment: 'B2B', region: 'СЗФО', objectType: '', tariff: 'Бизнес-4300', rent: true, installationCalculated: 2999 }), catalogs);

  assert.equal(defaults.installation.calculated, 5000);
  assert.equal(defaults.installation.final, 5000);
  assert.equal(below.installation.final, 2999);
  assert.ok(below.warnings.some(warning => warning.code === 'B2B_RENTAL_INSTALLATION_BELOW_MINIMUM'));
});

test('B2C rent uses rental lookup and adds 60 per additional sensor', () => {
  const result = engine().calculate(input({ rent: true, additionalHouseholdSensors: 1, additionalSecuritySensors: 2 }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Выгодный');
  assert.equal(result.monthlyFee.base, 2700);
  assert.equal(result.monthlyFee.rentalAdjustments, 180);
  assert.equal(result.monthlyFee.final, 2880);
  assert.ok(result.warnings.some(warning => warning.code === 'UNRESOLVED_RENTAL_OPTION'));
});

test('missing tariff rate returns a warning and null affected values', () => {
  const result = engine().calculate(input({ region: 'Неизвестный регион', monthlyFeeOverride: 1000 }), catalogs);

  assert.equal(result.monthlyFee.calculated, null);
  assert.equal(result.monthlyFee.final, null);
  assert.equal(result.monthlyFee.overridden, false);
  assert.ok(result.warnings.some(warning => warning.code === 'MISSING_TARIFF_RATE' && warning.field === 'tariff'));
});

test('selected options add monthly prices without double-counting camera option', () => {
  const result = engine().calculate(input({
    cameraCount: 2,
    selectedOptionNames: ['Видеокамера для Cesar Home', 'SMS оповещение о взятии/снятии'],
  }), catalogs);

  assert.equal(result.monthlyFee.base, 2300);
  assert.equal(result.monthlyFee.options, 400);
  assert.equal(result.monthlyFee.rentalAdjustments, 250);
  assert.equal(result.monthlyFee.final, 2950);
  assert.deepEqual(result.selectedOptions.map(option => option.name), ['Видеокамера для Cesar Home', 'SMS оповещение о взятии/снятии']);
});

test('B2B selected camera option remains billable because B2C video transitions do not apply', () => {
  const result = engine().calculate(input({
    segment: 'B2B',
    region: 'СЗФО',
    objectType: '',
    tariff: 'Бизнес-4300',
    cameraCount: 1,
    selectedOptionNames: ['Видеокамера Cesar Home V5/V4'],
  }), catalogs);

  assert.equal(result.monthlyFee.options, 250);
  assert.equal(result.monthlyFee.final, 4550);
});

test('selected option without a rate makes the affected monthly calculation null', () => {
  const result = engine().calculate(input({
    segment: 'B2B',
    region: 'СЗФО',
    objectType: '',
    tariff: 'Бизнес-4300',
    selectedOptionNames: ['Росгвардия'],
  }), catalogs);

  assert.equal(result.monthlyFee.options, null);
  assert.equal(result.monthlyFee.calculated, null);
  assert.equal(result.monthlyFee.final, null);
  assert.ok(result.warnings.some(warning => warning.code === 'MISSING_OPTION_RATE'));
});

test('liability follows resolved B2C level, B2B default, and override', () => {
  assert.equal(engine().calculate(input(), catalogs).materialLiability.final, 1000000);
  assert.equal(engine().calculate(input({ additionalHouseholdSensors: 1 }), catalogs).materialLiability.final, 1500000);
  assert.equal(engine().calculate(input({ tariff: 'Премиальный' }), catalogs).materialLiability.final, 2000000);
  assert.equal(engine().calculate(input({ segment: 'B2B', region: 'СЗФО', tariff: 'Бизнес-4300', objectType: '' }), catalogs).materialLiability.final, 2000000);
  assert.equal(engine().calculate(input({ materialLiabilityOverride: 123456 }), catalogs).materialLiability.final, 123456);
});

test('groupEquipment preserves first-seen group order and does not mutate input', () => {
  const items = [
    { system: 'b', systemLabel: 'Beta', code: '1', quantity: 1 },
    { system: 'a', systemLabel: 'Alpha', code: '2', quantity: 0 },
    { system: 'a', systemLabel: 'Alpha', code: '3', quantity: 2 },
    { system: 'b', systemLabel: 'Beta', code: '4', quantity: 3 },
  ];
  const before = structuredClone(items);
  const groups = engine().groupEquipment(items);

  assert.deepEqual(groups.map(group => [group.system, group.systemLabel, group.items.map(item => item.code)]), [
    ['b', 'Beta', ['1', '4']],
    ['a', 'Alpha', ['3']],
  ]);
  assert.deepEqual(items, before);
});

test('calculate does not mutate input or catalogs', () => {
  const sourceInput = input({ items: [{ system: 'x', systemLabel: 'X', code: '1', name: 'N', model: 'M', unit: 'шт.', quantity: 1, installedUnitPrice: 1 }] });
  const inputBefore = structuredClone(sourceInput);
  const catalogsBefore = structuredClone(catalogs);

  engine().calculate(sourceInput, catalogs);

  assert.deepEqual(sourceInput, inputBefore);
  assert.deepEqual(catalogs, catalogsBefore);
});

test('UMD bundle exposes CesarCalculator in a browser context', () => {
  const source = fs.readFileSync('public/calculator-engine.js', 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);

  assert.equal(typeof context.window.CesarCalculator.calculate, 'function');
  assert.equal(typeof context.window.CesarCalculator.applyOverride, 'function');
  assert.equal(typeof context.window.CesarCalculator.groupEquipment, 'function');
  assert.equal(typeof context.window.CesarCalculator.resolveTariff, 'function');
});

test('calculator engine loads before calculator and editor scripts', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const engineIndex = html.indexOf('<script src="/calculator-engine.js"></script>');
  const editorIndex = html.indexOf('<script src="/editor.js"></script>');

  assert.ok(engineIndex >= 0);
  assert.ok(engineIndex < editorIndex);
  const calculatorIndex = html.indexOf('<script src="/calculator.js"></script>');
  if (calculatorIndex >= 0) assert.ok(engineIndex < calculatorIndex);
});
