const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/editor.css', 'utf8');
const theme = fs.readFileSync('public/theme.css', 'utf8');
const catalogs = require('../data/catalogs/calculator.json');
const equipment = require('../data/catalogs/equipment.json').items;

function loadReportRenderer() {
  const context = {};
  context.window = context;
  vm.runInNewContext(fs.readFileSync('public/report-render.js', 'utf8'), context);
  return context.renderReport;
}

function loadUi() {
  delete require.cache[require.resolve('../public/editor.js')];
  return require('../public/editor.js').CesarProposalUI;
}

test('calculator form exposes every stable control id and safe script order', () => {
  const ids = [
    'proposalClientName', 'proposalClientPhone', 'proposalClientEmail', 'proposalSegment',
    'proposalRegion', 'proposalObjectType', 'proposalRent', 'equipmentSystemFilter',
    'equipmentSearch', 'equipmentResults', 'selectedEquipment', 'proposalTariff',
    'proposalCameraCount', 'proposalHouseholdSensors', 'proposalSecuritySensors',
    'proposalOptions', 'proposalDiscount', 'overrideInstallation', 'resetInstallation',
    'overrideMonthlyFee', 'resetMonthlyFee', 'overrideMaterialLiability',
    'resetMaterialLiability', 'proposalWarnings', 'proposalTotals', 'btnExportPdf',
    'btnExportXlsx',
  ];
  ids.forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`), id));
  const scripts = ['promotions.js', 'calculator-catalogs.js', 'calculator-engine.js', 'calculator.js', 'report-render.js', 'editor.js'];
  scripts.reduce((previous, script) => {
    const index = html.indexOf(`/` + script);
    assert.ok(index > previous, `${script} follows its dependencies`);
    return index;
  }, -1);
});

test('UI helpers search, add, increment, validate, delete and reset manual prices', () => {
  const ui = loadUi();
  const source = equipment.find(item => item.code === '100118');
  const results = ui.filterEquipment(equipment, { query: 'фотореле', system: 'hikvision' });
  assert.ok(results.some(item => item.code === source.code));
  assert.deepEqual(ui.filterEquipment(equipment, { query: 'ф', system: '' }), []);

  const proposal = { items: [] };
  ui.addEquipment(proposal, source);
  assert.equal(proposal.items[0].quantity, 1);
  assert.equal(proposal.items[0].identity, 'hikvision:100118');
  assert.equal(proposal.items[0].sourceInstalledUnitPrice, 1300);
  ui.addEquipment(proposal, source);
  assert.equal(proposal.items[0].quantity, 2);
  assert.equal(ui.setQuantity(proposal, 'hikvision:100118', 'bad').valid, false);
  assert.equal(proposal.items[0].quantity, 2, 'invalid quantity does not corrupt state');
  assert.equal(ui.setQuantity(proposal, 'hikvision:100118', 3).valid, true);
  ui.setManualPrice(proposal, 'hikvision:100118', 1400);
  assert.equal(proposal.items[0].installedUnitPrice, 1400);
  assert.equal(proposal.items[0].priceOverridden, true);
  ui.resetManualPrice(proposal, 'hikvision:100118');
  assert.equal(proposal.items[0].installedUnitPrice, 1300);
  ui.removeEquipment(proposal, 'hikvision:100118');
  assert.deepEqual(proposal.items, []);
});

test('scenario options are catalog-derived and preserve only compatible values', () => {
  const ui = loadUi();
  const b2c = ui.scenarioOptions(catalogs, { segment: 'B2C', rent: false });
  assert.ok(b2c.regions.includes('Москва/МО, ЦФО'));
  assert.ok(b2c.objectTypes.includes('Квартира'));
  assert.ok(b2c.tariffs.includes('Базовый'));
  const b2b = ui.scenarioOptions(catalogs, { segment: 'B2B', rent: false });
  assert.ok(b2b.regions.includes('СЗФО'));
  assert.ok(b2b.tariffs.includes('Бизнес-4300'));
  assert.equal(b2b.objectTypes.length, 0);
  assert.equal(ui.compatibleValue('Базовый', b2b.tariffs), '');
  assert.equal(ui.compatibleValue('Бизнес-4300', b2b.tariffs), 'Бизнес-4300');
});

test('warning and override helpers never turn missing money into zero', () => {
  const ui = loadUi();
  const valid = { client: { name: 'ООО Тест' }, scenario: { segment: 'B2C', region: 'Москва', objectType: 'Квартира' }, items: [{ quantity: 1 }], computed: { equipment: { afterDiscount: 1000 }, installation: { final: 500 }, oneTime: { final: 1500 }, monthlyFee: { final: 1990 }, materialLiability: { final: 1000000 }, warnings: [] } };
  assert.equal(ui.formatMoney(null), '—');
  assert.match(ui.overrideView({ calculated: 1990, final: 1500, overridden: true }).badge, /Изменено вручную/);
  assert.equal(ui.overrideView({ calculated: null, final: null, overridden: false }).final, '—');
  assert.equal(ui.isProposalValid(valid), true);
  assert.equal(ui.isProposalValid({ client: { name: '' }, scenario: {}, items: [], computed: { warnings: [] } }), false);
  assert.equal(ui.isProposalValid({ ...valid, computed: { ...valid.computed, monthlyFee: { final: null } } }), false);
  assert.equal(ui.isProposalValid({ ...valid, scenario: { ...valid.scenario, segment: 'OTHER' } }), false);
  assert.equal(ui.publicationErrors({ ...valid, computed: { ...valid.computed, warnings: [{ code: 'MISSING_RATE' }] } })[0].section, 'totals');
});

test('options are filtered by explicit category and segment switches retain only shared entries', () => {
  const ui = loadUi();
  const options = [
    { name: 'Только B2C', category: 'B2C' },
    { name: 'Только B2B', category: 'B2B' },
    { name: 'Общая', category: 'shared' },
    { name: 'Без категории' },
  ];
  assert.deepEqual(ui.optionsForSegment(options, 'B2C').map(item => item.name), ['Только B2C', 'Общая']);
  assert.deepEqual(ui.optionsForSegment(options, 'B2B').map(item => item.name), ['Только B2B', 'Общая']);
  assert.deepEqual(ui.optionsAfterSegmentChange(['Только B2C', 'Общая'], options), ['Общая']);
  assert.deepEqual(ui.reconcileOptions(['Только B2B', 'Общая'], options, 'B2C'), ['Общая']);
  const stateApi = require('../public/calculator.js');
  const proposal = stateApi.createDefaultProposal();
  proposal.selectedOptionNames = ui.reconcileOptions(['Росгвардия'], catalogs.options, 'B2C');
  stateApi.calculateProposal(proposal, catalogs);
  assert.equal(proposal.computed.warnings.some(warning => warning.code === 'MISSING_OPTION_RATE'), false);
});

test('report includes an escaped client proposal only when equipment exists', () => {
  const render = loadReportRenderer();
  const legacy = render({ title: 'Legacy', events: [], promotions: [] });
  assert.doesNotMatch(legacy, /rp-proposal/);

  const output = render({
    title: 'КП', object: { address: 'Москва' },
    proposal: {
      client: { name: '<img src=x onerror=alert(1)>', phone: '+7', email: 'x&y@example.test' },
      scenario: { tariff: 'Базовый' }, selectedOptionNames: ['SMS <test>'],
      items: [{ system: 'ritm', systemLabel: 'Ритм', code: '<1>', name: 'Датчик & кнопка', model: 'M1', quantity: 2, installedUnitPrice: 1000 }],
      computed: {
        equipment: [{ system: 'ritm', systemLabel: 'Ритм', code: '<1>', name: 'Датчик & кнопка', model: 'M1', quantity: 2, installedUnitPrice: 1000, lineTotal: 2000 }],
        equipmentGroups: [{ system: 'ritm', systemLabel: 'Ритм', items: [{ code: '<1>', name: 'Датчик & кнопка', model: 'M1', quantity: 2, installedUnitPrice: 1000, lineTotal: 2000 }] }],
        oneTime: { equipmentSubtotal: 2000, discount: 0, installation: { final: 500 }, final: 2500 },
        monthlyFee: { final: 1990 }, materialLiability: { final: 1000000 }, tariff: { resolvedName: 'Базовый' }, warnings: [],
      },
    },
    promotions: [{ title: 'Акция <b>', description: 'Описание', image: '' }], events: [],
  });
  assert.match(output, /rp-proposal/);
  assert.match(output, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(output, /Датчик &amp; кнопка/);
  assert.doesNotMatch(output, /source|override|warning/i);
});

test('responsive and accessible contracts are explicit', () => {
  assert.match(html, /id="equipmentResults"[^>]*role="listbox"/);
  assert.match(html, /id="proposalWarnings"[^>]*aria-live="polite"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.match(css, /\[data-label\]/);
  assert.match(css + theme, /:focus-visible/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /id="modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="successDialogTitle"/);
  assert.match(html, /id="successDialogTitle"/);
  assert.match(html, /id="previewDialogTitle"/);
  assert.match(fs.readFileSync('public/editor.js', 'utf8'), /inert/);
  assert.match(fs.readFileSync('public/editor.js', 'utf8'), /Shift|shiftKey/);
  assert.match(fs.readFileSync('public/editor.js', 'utf8'), /Escape/);
});

test('export controls start disabled and explain current availability honestly', () => {
  assert.match(html, /id="btnExportPdf"[^>]*disabled/);
  assert.match(html, /id="btnExportXlsx"[^>]*disabled/);
  assert.match(html, /PDF-предложение и смета XLSX доступны после заполнения обязательных полей\./);
});

test('public projection strips every calculator-internal field', () => {
  const ui = loadUi();
  const draft = {
    title: 'КП', subtitle: 'Для клиента', object: { pin: '1', address: 'Москва' },
    heroPhoto: '/hero.jpg', summary: { alarms: '1' }, eventsTitle: 'События', events: [],
    promotions: [{ id: 'promo', title: 'Акция', description: 'Текст', image: '/p.jpg', priority: 100 }],
    manager: { name: 'Менеджер', email: 'm@example.test', internal: true },
    proposal: {
      schemaVersion: 1,
      client: { name: 'ООО Тест', phone: '+7', email: 'c@example.test' },
      scenario: { segment: 'B2C', region: 'Москва', objectType: 'Квартира', tariff: 'Базовый', rent: false, baseMonthlyFee: 1990 },
      items: [{ identity: 'ritm:1', system: 'ritm', systemLabel: 'Ритм', code: '1', name: 'Датчик', model: 'M', unit: 'шт.', quantity: 1, installedUnitPrice: 1000, sourceInstalledUnitPrice: 900, priceOverridden: true, sources: [{ workbook: 'secret.xls' }] }],
      selectedOptionNames: ['SMS'], discountPercent: 5,
      overrides: { monthlyFeeOverride: 1 }, exportMetadata: { generatedBy: 'internal' },
      computed: {
        equipment: { items: [{ system: 'ritm', code: '1', name: 'Датчик', quantity: 1, installedUnitPrice: 1000, sourceInstalledUnitPrice: 900, lineTotal: 1000 }], subtotal: 1000, discountAmount: 50, afterDiscount: 950 },
        installation: { calculated: 500, override: 400, final: 400, overridden: true },
        oneTime: { final: 1350 }, monthlyFee: { calculated: 1990, override: 1800, final: 1800, overridden: true },
        materialLiability: { calculated: 1000000, final: 1000000, overridden: false },
        tariff: { requestedName: 'Базовый', resolvedName: 'Базовый', automaticChanges: [] },
        selectedOptions: [], warnings: [{ code: 'SECRET', message: 'internal' }], exportGroups: [],
      },
    },
  };
  const output = ui.publicReportProjection(draft);
  const json = JSON.stringify(output);
  ['sourceInstalledUnitPrice', 'priceOverridden', 'sources', 'overrides', 'warnings', 'exportMetadata', 'identity', 'baseMonthlyFee', 'calculated', 'override', 'overridden', 'priority', 'internal'].forEach(key => assert.doesNotMatch(json, new RegExp(`"${key}"`), key));
  assert.equal(output.proposal.items[0].installedUnitPrice, 1000);
  assert.equal(output.proposal.computed.monthlyFee.final, 1800);
  assert.equal(output.promotions[0].title, 'Акция');
});

test('editor preview renders actionable warnings while public report omits them', () => {
  const render = loadReportRenderer();
  const data = { proposal: { items: [{ quantity: 1 }], computed: { warnings: [{ message: '<b>Проверьте тариф</b>' }] } }, promotions: [], events: [] };
  const preview = render(data, { editorPreview: true });
  const publicHtml = render(data);
  assert.match(preview, /rp-preview-warnings/);
  assert.match(preview, /&lt;b&gt;Проверьте тариф&lt;\/b&gt;/);
  assert.doesNotMatch(publicHtml, /Проверьте тариф|rp-preview-warnings/);
});

test('focus helpers preserve stable controls and choose a deterministic delete target', () => {
  const ui = loadUi();
  const items = [{ identity: 'a:1' }, { identity: 'b:2' }, { identity: 'c:3' }];
  assert.equal(ui.nextFocusAfterDelete(items, 'b:2'), 'qty-input:c:3');
  assert.equal(ui.nextFocusAfterDelete(items, 'c:3'), 'qty-input:b:2');
  assert.equal(ui.nextFocusAfterDelete([{ identity: 'a:1' }], 'a:1'), 'equipmentSearch');
  assert.match(fs.readFileSync('public/editor.js', 'utf8'), /data-focus-key/);
});
