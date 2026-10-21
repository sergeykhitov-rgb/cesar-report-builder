const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const calculator = JSON.parse(fs.readFileSync('data/catalogs/calculator.json', 'utf8'));
const equipment = JSON.parse(fs.readFileSync('data/catalogs/equipment.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('data/catalogs/import-manifest.json', 'utf8'));

function runDuplicateConflict(field, firstValue, secondValue) {
  const script = String.raw`
import importlib.util
import pathlib

path = pathlib.Path('scripts/import-calculator-data.py')
spec = importlib.util.spec_from_file_location('calculator_import', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

base = {
    'system': 'ritm',
    'systemLabel': 'Ритм',
    'code': 'TEST-42',
    'name': 'Датчик',
    'model': 'A1',
    'unit': 'шт.',
    'installedUnitPrice': 100,
}
first = {**base, ${JSON.stringify(field)}: ${JSON.stringify(firstValue)}, 'source': {
    'workbook': 'template.xls', 'sheet': 'Sheet A', 'row': 11,
}}
second = {**base, ${JSON.stringify(field)}: ${JSON.stringify(secondValue)}, 'source': {
    'workbook': 'template.xls', 'sheet': 'Sheet B', 'row': 19,
}}
module.deduplicate_equipment([first, second])
`;
  return spawnSync('python3', ['-c', script], { encoding: 'utf8' });
}

test('importer rejects duplicate equipment keys with different names and reports both sources', () => {
  const result = runDuplicateConflict('name', 'Датчик дыма', 'Датчик воды');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ritm.*TEST-42/s);
  assert.match(result.stderr, /Sheet A.*row 11/s);
  assert.match(result.stderr, /Sheet B.*row 19/s);
  assert.match(result.stderr, /name/);
});

test('importer rejects duplicate equipment keys with different models', () => {
  const result = runDuplicateConflict('model', 'A1', 'B2');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ritm.*TEST-42/s);
  assert.match(result.stderr, /model/);
});

test('calculator catalog contains every required source section and control values', () => {
  const requiredSections = [
    'b2cTariffs',
    'b2cTransitions',
    'b2cRentalTariffs',
    'b2bTariffs',
    'options',
    'rentalLogic',
    'materialLiability',
    'discounts',
    'responseTimes',
    'unresolvedDecisions',
  ];

  requiredSections.forEach(section => assert.ok(section in calculator, `missing ${section}`));
  assert.equal(calculator.materialLiability.b2c.apartment.basic, 1000000);
  assert.equal(calculator.materialLiability.b2c.apartment.value, 1500000);
  assert.equal(calculator.materialLiability.b2c.apartment.premium, 2000000);
  assert.equal(
    calculator.options.find(item => item.name === 'Видеокамера для Cesar Home').monthlyPrice,
    250,
  );
  assert.equal(
    calculator.options.find(item => item.name === 'EMAIL оповещение о взятии/снятии').monthlyPrice,
    0,
  );
});

test('equipment rows have unique source keys, numeric prices, and retained provenance', () => {
  const keys = equipment.items.map(item => `${item.system}:${item.code}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(equipment.items.length > 0);

  equipment.items.forEach(item => {
    assert.match(item.system, /^(ritm|si-nord|hikvision|rental-used|other)$/);
    assert.ok(item.code);
    assert.ok(item.name);
    assert.ok(Number.isFinite(item.installedUnitPrice));
    assert.ok(item.sources.length >= 1);
    item.sources.forEach(source => {
      assert.equal(source.workbook, 'Спецификация_НДВ_для кальк окт.xls');
      assert.equal(typeof source.sheet, 'string');
      assert.ok(Number.isInteger(source.row) && source.row > 0);
    });
  });

  assert.ok(!equipment.items.some(item =>
    item.sources.some(source => source.sheet === '13.08.26 2725' || source.sheet === '13.08.26')
  ));
});

test('import manifest records all source workbooks with hashes and sheet names', () => {
  assert.equal(manifest.sources.length, 3);
  assert.deepEqual(
    manifest.sources.map(source => source.basename).sort(),
    [
      'Копия Спецификация_НДВ_6065286.xls',
      'Спецификация_НДВ_для кальк окт.xls',
      'Справочники_калькулятора_НДВ_00000002.xlsx',
    ].sort(),
  );
  manifest.sources.forEach(source => {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.sheetNames.length > 0);
    assert.ok(!('path' in source), 'manifest must not expose an absolute source path');
  });
  assert.deepEqual(
    Object.fromEntries(manifest.sources.map(source => [source.basename, source.sha256])),
    {
      'Справочники_калькулятора_НДВ_00000002.xlsx': 'af0d7c2bd8d27157a9ce262345fb42a80bd104f4e677f749cc4618b36970eabc',
      'Спецификация_НДВ_для кальк окт.xls': '5b751a14a29c8a12c3df2a47a7820d369067e86a87d4e39e5d24a504c267dccb',
      'Копия Спецификация_НДВ_6065286.xls': 'ab641c7ad70869d8df88311d7495811e291646230bb5417363b470f5b4cca6a5',
    },
  );
  assert.equal(manifest.deterministic, true);
  assert.ok(!('generatedAt' in manifest));
});
