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

test('invalid counters warn and are ignored before transitions and charges', () => {
  const cases = [
    ['cameraCount', -1],
    ['additionalHouseholdSensors', 0.5],
    ['additionalSecuritySensors', 'oops'],
    ['baseSecuritySensorCount', -2],
    ['cameraCount', Number.MAX_VALUE],
  ];

  for (const [field, value] of cases) {
    const result = engine().calculate(input({ [field]: value }), catalogs);
    assert.equal(result.tariff.resolvedName, 'Базовый', field);
    assert.equal(result.monthlyFee.rentalAdjustments, 0, field);
    assert.equal(Number.isNaN(result.monthlyFee.final), false, field);
    assert.ok(result.warnings.some(warning => warning.code === 'INVALID_COUNT' && warning.field === field), field);
  }
});

test('invalid fractional camera count cannot suppress an explicitly selected camera option', () => {
  const result = engine().calculate(input({
    cameraCount: 1.5,
    selectedOptionNames: ['Видеокамера для Cesar Home'],
  }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Базовый');
  assert.equal(result.monthlyFee.options, 250);
  assert.equal(result.monthlyFee.final, 2240);
  assert.ok(result.warnings.some(warning => warning.code === 'INVALID_COUNT' && warning.field === 'cameraCount'));
});

test('money rounds decimal half-up to kopecks for values, multiplication, and sums', () => {
  const direct = engine().applyOverride(0, 10.075);
  const result = engine().calculate(input({
    items: [
      { system: 'x', systemLabel: 'X', code: '1', name: 'One', model: '', unit: 'шт.', quantity: 1, installedUnitPrice: 10.075 },
      { system: 'x', systemLabel: 'X', code: '2', name: 'Two', model: '', unit: 'шт.', quantity: 3, installedUnitPrice: 3.355 },
      { system: 'x', systemLabel: 'X', code: '3', name: 'Three', model: '', unit: 'шт.', quantity: 1, installedUnitPrice: 0.005 },
    ],
  }), catalogs);

  assert.equal(direct.final, 10.08);
  assert.deepEqual(result.equipment.items.map(item => item.lineTotal), [10.08, 10.07, 0.01]);
  assert.equal(result.equipment.subtotal, 20.16);
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

test('Econom sensor scenario stays unresolved and surfaces the matching catalog decision', () => {
  const result = engine().calculate(input({
    region: 'ПФО, ЮФО, УФО, СФО',
    tariff: 'Эконом',
    additionalHouseholdSensors: 1,
  }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Эконом');
  assert.ok(result.warnings.some(warning =>
    warning.code === 'UNRESOLVED_RULE'
    && warning.field === 'tariff'
    && /Эконом/.test(warning.message)
  ));
});

test('B2B rent increases a supplied 5000 base tariff by 15 percent', () => {
  const result = engine().calculate(input({
    segment: 'B2B', region: 'Москва и МО, ЦФО', objectType: '', tariff: '', rent: true, baseMonthlyFee: 5000,
  }), catalogs);

  assert.equal(result.monthlyFee.base, 5000);
  assert.equal(result.monthlyFee.rentalAdjustments, 750);
  assert.equal(result.monthlyFee.final, 5750);
});

test('B2B sensors do not invent a transition and surface the matching unresolved decision', () => {
  const result = engine().calculate(input({
    segment: 'B2B',
    region: 'СЗФО',
    objectType: '',
    tariff: 'Бизнес-4300',
    additionalSecuritySensors: 1,
  }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Бизнес-4300');
  assert.ok(result.warnings.some(warning =>
    warning.code === 'UNRESOLVED_RULE'
    && warning.field === 'tariff'
    && /Переходы/.test(warning.message)
  ));
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
  const unresolved = result.warnings.filter(warning =>
    warning.code === 'UNRESOLVED_RULE'
    && warning.field === 'rent'
    && /Аренда/.test(warning.message)
  );
  assert.equal(unresolved.length, 1);
  assert.equal(result.warnings.some(warning => warning.code === 'UNRESOLVED_RENTAL_OPTION'), false);
});

test('B2C rental sensor rate safely parses the catalog руб variant', () => {
  const variantCatalogs = structuredClone(catalogs);
  const rule = variantCatalogs.rentalLogic.find(item => item.category === 'B2C' && item.parameter === 'Дополнительные датчики');
  rule.value = '60 руб за каждый';

  const result = engine().calculate(input({ rent: true, additionalSecuritySensors: 2 }), variantCatalogs);

  assert.equal(result.monthlyFee.rentalAdjustments, 120);
  assert.equal(result.monthlyFee.final, 2420);
});

test('missing or unrecognized rental sensor rate warns and nulls the affected calculation', () => {
  const variants = [
    catalogs.rentalLogic.filter(item => !(item.category === 'B2C' && item.parameter === 'Дополнительные датчики')),
    catalogs.rentalLogic.map(item => item.category === 'B2C' && item.parameter === 'Дополнительные датчики'
      ? { ...item, value: 'около 60 ₽' }
      : item),
  ];

  for (const rentalLogic of variants) {
    const result = engine().calculate(input({ rent: true, additionalHouseholdSensors: 1 }), { ...catalogs, rentalLogic });
    assert.equal(result.monthlyFee.rentalAdjustments, null);
    assert.equal(result.monthlyFee.calculated, null);
    assert.equal(result.monthlyFee.final, null);
    assert.ok(result.warnings.some(warning => warning.code === 'MISSING_RENTAL_SENSOR_RATE' && warning.field === 'rentalLogic'));
  }
});

test('B2C rent keeps selected equipment data but makes its payable contribution zero without mutation', () => {
  const sourceInput = input({
    rent: true,
    installationCalculated: 500,
    items: [{
      system: 'ritm',
      systemLabel: 'Ритм',
      code: 'RENT-1',
      name: 'Арендный комплект',
      model: 'R1',
      unit: 'шт.',
      quantity: 2,
      installedUnitPrice: 1200,
      category: 'Комплект',
    }],
  });
  const before = structuredClone(sourceInput);

  const result = engine().calculate(sourceInput, catalogs);

  assert.equal(result.equipment.items[0].installedUnitPrice, 1200);
  assert.equal(result.equipment.items[0].lineTotal, 2400);
  assert.equal(result.equipment.afterDiscount, 0);
  assert.equal(result.oneTime.final, 500);
  assert.deepEqual(sourceInput, before);
});

test('one camera keeps video display tariff but uses underlying Value rental rate', () => {
  const result = engine().calculate(input({ rent: true, tariff: 'Выгодный', cameraCount: 1 }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Видео Выгодный');
  assert.equal(result.monthlyFee.base, 2700);
  assert.equal(result.monthlyFee.rentalAdjustments, 0);
  assert.equal(result.monthlyFee.final, 2700);
  assert.equal(result.warnings.some(warning => warning.code === 'MISSING_TARIFF_RATE'), false);
});

test('three rental cameras use Basic rental rate and charge only two extra cameras', () => {
  const result = engine().calculate(input({ rent: true, cameraCount: 3 }), catalogs);

  assert.equal(result.tariff.resolvedName, 'Видео Базовый');
  assert.equal(result.monthlyFee.base, 2300);
  assert.equal(result.monthlyFee.rentalAdjustments, 500);
  assert.equal(result.monthlyFee.final, 2800);
  assert.equal(result.warnings.some(warning => warning.code === 'MISSING_TARIFF_RATE'), false);
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

test('duplicate selected option names are charged once in first-seen order', () => {
  const result = engine().calculate(input({
    selectedOptionNames: [
      'SMS оповещение о взятии/снятии',
      'SMS оповещение о взятии/снятии',
      'EMAIL оповещение о взятии/снятии',
    ],
  }), catalogs);

  assert.deepEqual(result.selectedOptions.map(option => option.name), [
    'SMS оповещение о взятии/снятии',
    'EMAIL оповещение о взятии/снятии',
  ]);
  assert.equal(result.monthlyFee.options, 400);
  assert.equal(result.monthlyFee.final, 2390);
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
