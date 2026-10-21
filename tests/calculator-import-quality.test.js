const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runPython(body) {
  return spawnSync('python3', ['-c', `
import importlib.util
import pathlib
path = pathlib.Path('scripts/import-calculator-data.py')
spec = importlib.util.spec_from_file_location('calculator_import', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
${body}
`], { encoding: 'utf8' });
}

test('numeric parser rejects embedded letters with complete source context', () => {
  const result = runPython(`module.normalize_number(
    '12abc34', source={'workbook': 'bad.xls', 'sheet': 'Prices', 'row': 7}, field='installed price'
)`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /12abc34/);
  assert.match(result.stderr, /bad\.xls.*Prices.*row 7.*installed price/s);
});

test('numeric parser rejects corrupted punctuation instead of recovering a price', () => {
  const result = runPython(`module.normalize_number(
    '1,2,3', source={'workbook': 'bad.xls', 'sheet': 'Prices', 'row': 8}, field='installed price'
)`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /1,2,3/);
  assert.match(result.stderr, /bad\.xls.*Prices.*row 8.*installed price/s);
});

test('only explicitly reviewed non-price equipment annotations are skipped', () => {
  const result = runPython(`
assert module.is_reviewed_non_price_equipment(
    '50663', 'Кабель электропитания 2*0.75мм, ШВВП - 3м', 'Для реле и выключателя'
)
assert module.is_reviewed_non_price_equipment(
    '96937', 'Шнур ШВВП с плоской вилкой', 'Для сирены'
)
assert not module.is_reviewed_non_price_equipment('50663', 'Кабель', '12abc34')
`);
  assert.equal(result.status, 0, result.stderr);
});

test('equipment header map supports reordered known column variants', () => {
  const result = runPython(`
headers = ['Модель', 'Цена оборудования с установкой за единицу, руб. с НДС', 'Ед. изм.', 'Наименование оборудования', 'Кол-во', 'Код']
print(module.build_equipment_header_map(headers, {'workbook': 'fixture.xlsx', 'sheet': 'Reordered', 'row': 1}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /'code': 5/);
  assert.match(result.stdout, /'installed_price': 1/);
});

test('equipment header map rejects missing and duplicate required columns with context', () => {
  for (const headers of [
    ['Код', 'Наименование оборудования', 'Модель', 'Ед. изм.', 'Кол-во'],
    ['Код', 'Код', 'Наименование оборудования', 'Модель', 'Ед. изм.', 'Кол-во', 'Цена оборудования с установкой за единицу, руб. с НДС'],
  ]) {
    const result = runPython(`module.build_equipment_header_map(${JSON.stringify(headers)}, {'workbook': 'fixture.xlsx', 'sheet': 'Broken', 'row': 4})`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fixture\.xlsx.*Broken.*row 4/s);
  }
});

test('allowlist validator rejects a canonical value outside its reviewed variants', () => {
  const result = runPython(`module.validate_equipment_variant_allowlist({
    ('ritm', 'BAD'): {'canonical': ('Unexpected', 'X'), 'variants': {('Expected', 'X')}}
})`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ritm.*BAD.*canonical/s);
});

test('atomic catalog writer leaves every existing output unchanged on serialization failure', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-atomic-'));
  try {
    const result = runPython(`
from pathlib import Path
output = Path(${JSON.stringify(temp)})
for name in ('calculator.json', 'equipment.json', 'import-manifest.json'):
    (output / name).write_text('original-' + name, encoding='utf-8')
try:
    module.write_catalogs_atomically(output, {'ok': True}, {'bad': {1, 2}}, {'ok': True})
except (TypeError, ValueError):
    pass
else:
    raise AssertionError('serialization unexpectedly succeeded')
for name in ('calculator.json', 'equipment.json', 'import-manifest.json'):
    assert (output / name).read_text(encoding='utf-8') == 'original-' + name
`);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('atomic catalog writer restores all originals when the second staged replacement fails', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-rollback-'));
  try {
    const result = runPython(`
from pathlib import Path
output = Path(${JSON.stringify(temp)})
originals = {
    'calculator.json': b'original-calculator\\x00\\xff',
    'equipment.json': b'original-equipment\\x01\\xfe',
    'import-manifest.json': b'original-manifest\\x02\\xfd',
}
for name, content in originals.items():
    (output / name).write_bytes(content)

real_replace = module.os.replace
failed = False
def fail_second_install(source, destination):
    global failed
    source = Path(source)
    destination = Path(destination)
    if not failed and source.suffix == '.tmp' and destination.name == 'equipment.json':
        failed = True
        raise OSError('injected second replacement failure')
    return real_replace(source, destination)

module.os.replace = fail_second_install
try:
    module.write_catalogs_atomically(output, {'new': 1}, {'new': 2}, {'new': 3})
except OSError as error:
    assert 'injected second replacement failure' in str(error)
else:
    raise AssertionError('replacement unexpectedly succeeded')
finally:
    module.os.replace = real_replace

for name, content in originals.items():
    assert (output / name).read_bytes() == content, name
assert sorted(path.name for path in output.iterdir()) == sorted(originals), list(output.iterdir())
`);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('atomic catalog rollback removes newly installed files that had no original destination', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-rollback-missing-'));
  try {
    const result = runPython(`
from pathlib import Path
output = Path(${JSON.stringify(temp)})
(output / 'calculator.json').write_bytes(b'original-calculator')
(output / 'import-manifest.json').write_bytes(b'original-manifest')

real_replace = module.os.replace
failed = False
def fail_third_install(source, destination):
    global failed
    source = Path(source)
    destination = Path(destination)
    if not failed and source.suffix == '.tmp' and destination.name == 'import-manifest.json':
        failed = True
        raise OSError('injected third replacement failure')
    return real_replace(source, destination)

module.os.replace = fail_third_install
try:
    module.write_catalogs_atomically(output, {'new': 1}, {'new': 2}, {'new': 3})
except OSError:
    pass
else:
    raise AssertionError('replacement unexpectedly succeeded')
finally:
    module.os.replace = real_replace

assert (output / 'calculator.json').read_bytes() == b'original-calculator'
assert not (output / 'equipment.json').exists()
assert (output / 'import-manifest.json').read_bytes() == b'original-manifest'
assert sorted(path.name for path in output.iterdir()) == ['calculator.json', 'import-manifest.json']
`);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('importer produces identical expected JSON on two fixture runs', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-import-'));
  try {
    let result = spawnSync('python3', ['tests/helpers/generate-calculator-import-fixtures.py', temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const args = [
      'scripts/import-calculator-data.py',
      '--reference', path.join(temp, 'reference.xlsx'),
      '--template', path.join(temp, 'template.xlsx'),
      '--example', path.join(temp, 'example.xlsx'),
    ];
    const outputs = [];
    for (const name of ['first', 'second']) {
      const output = path.join(temp, name);
      result = spawnSync('python3', [...args, '--output', output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      outputs.push(Object.fromEntries(
        ['calculator.json', 'equipment.json', 'import-manifest.json']
          .map(file => [file, fs.readFileSync(path.join(output, file), 'utf8')])
      ));
    }
    assert.deepEqual(outputs[0], outputs[1]);
    const equipment = JSON.parse(outputs[0]['equipment.json']);
    assert.deepEqual(equipment.items.map(item => ({
      system: item.system,
      code: item.code,
      name: item.name,
      model: item.model,
      unit: item.unit,
      installedUnitPrice: item.installedUnitPrice,
    })), [{
      system: 'ritm', code: 'FX-001', name: 'Fixture sensor', model: 'FX-1', unit: 'шт.', installedUnitPrice: 1234,
    }]);
    assert.deepEqual(equipment.exampleControl.selectedRows, [{
      sheet: 'Ритм fixture', row: 2, code: 'FX-001', quantity: 2,
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
