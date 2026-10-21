'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { buildEstimateWorkbook, estimateFilename, uniqueEstimateFilenames } = require('../lib/xlsx-export');

function fixture() {
  return {
    client: { name: 'ООО «Клиент»' },
    object: { pin: '123456', account: 'ЛС-77', invoice: 'Счёт №42', address: 'Москва, Тверская, 1' },
    generatedAt: '2026-10-21T09:00:00.000Z',
    items: [
      { system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Контрольная панель', model: 'Контакт GSM-5', unit: 'шт.', quantity: 2, installedUnitPrice: 12500 },
      { system: 'ritm', systemLabel: 'РИТМ', code: 'R-0', name: 'Арендное оборудование', model: '', unit: 'шт.', quantity: 1, installedUnitPrice: 0 },
      { system: 'hikvision', systemLabel: 'Hikvision', code: 'H-1', name: 'Камера', model: 'DS-2CD', unit: 'шт.', quantity: 3, installedUnitPrice: 8000 },
    ],
    computed: { equipment: { afterDiscount: 25000 }, discountPercent: 0 },
  };
}

async function reopen(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

test('buildEstimateWorkbook returns a reopenable XLSX with group-only rows, formulas and CESAR print layout', async () => {
  const buffer = await buildEstimateWorkbook(fixture(), { id: 'ritm', label: 'РИТМ' });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');

  const workbook = await reopen(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, 'Смета');
  assert.equal(sheet.getCell('A1').value, 'Спецификация');
  const allText = sheet.getSheetValues().flat(2).map(value => typeof value === 'object' && value ? value.result || value.formula || '' : value).join(' | ');
  assert.match(allText, /ООО «Клиент»/);
  assert.match(allText, /123456/);
  assert.match(allText, /ЛС-77/);
  assert.match(allText, /Счёт №42/);
  assert.match(allText, /Москва, Тверская, 1/);
  assert.match(allText, /РИТМ/);
  assert.doesNotMatch(allText, /Hikvision|H-1|Камера/);

  let headerRow;
  sheet.eachRow(row => { if (row.values.includes('Код')) headerRow = row; });
  assert.ok(headerRow, 'table header exists');
  assert.deepEqual(headerRow.values.slice(1), [
    '№', 'Код', 'Наименование оборудования', 'Модель', 'Ед. изм.', 'Кол-во',
    'Цена оборудования с установкой за единицу, руб. с НДС',
    'Стоимость оборудования с установкой за количество, руб. с НДС.',
  ]);
  const first = headerRow.number + 1;
  assert.equal(sheet.getCell(first, 6).value, 2);
  assert.equal(sheet.getCell(first, 7).value, 12500);
  assert.deepEqual(sheet.getCell(first, 8).value, { formula: `F${first}*G${first}`, result: 25000 });
  assert.equal(sheet.getCell(first + 1, 7).value, 0, 'legitimate rental zero is preserved');
  assert.equal(sheet.getCell(first + 1, 8).value.formula, `F${first + 1}*G${first + 1}`);
  assert.equal(sheet.getCell(first + 1, 8).value.result || 0, 0, 'ExcelJS may omit a cached numeric zero');
  const totalCell = sheet.getCell(first + 2, 8);
  assert.deepEqual(totalCell.value, { formula: `SUM(H${first}:H${first + 1})`, result: 25000 });
  assert.match(sheet.getCell(first, 7).numFmt, /₽|руб/);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, headerRow.number);
  assert.ok(sheet.autoFilter);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToPage, true);
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.match(sheet.pageSetup.printArea, /^A1:H\d+$/);
  assert.ok(sheet.pageSetup.printTitlesRow);
  assert.ok(sheet.columns.every(column => column.width >= 5));
});

test('workbook never exposes internal fields and stores formula-like text as literal text', async () => {
  const proposal = fixture();
  proposal.client.name = '=HYPERLINK("https://evil")';
  proposal.items[0].code = '+1+1';
  proposal.items[0].name = '@SUM(A1:A2)';
  proposal.items[0].model = '-2+3';
  proposal.items[0].overrideReason = 'SECRET REASON';
  proposal.items[0].sourceInstalledUnitPrice = 1;
  proposal.provenance = 'SECRET SOURCE';
  const workbook = await reopen(await buildEstimateWorkbook(proposal, { id: 'ritm', label: 'РИТМ' }));
  const sheet = workbook.worksheets[0];
  const strings = [];
  sheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string') strings.push(cell.value);
    assert.notEqual(typeof cell.value === 'object' && cell.value && cell.value.formula, true);
  }));
  assert.ok(strings.includes("'=HYPERLINK(\"https://evil\")"));
  assert.ok(strings.includes("'+1+1"));
  assert.ok(strings.includes("'@SUM(A1:A2)"));
  assert.ok(strings.includes("'-2+3"));
  assert.doesNotMatch(strings.join(' '), /SECRET REASON|SECRET SOURCE/);
});

test('builder rejects malformed proposal, group, items, quantities and prices', async () => {
  const valid = fixture();
  const invalidCases = [
    [null, { id: 'ritm', label: 'РИТМ' }],
    [valid, null],
    [{ ...valid, client: { name: '' } }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [] }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: Array.from({ length: 201 }, (_, index) => ({ system: 'ritm', code: String(index), name: 'X', quantity: 1, installedUnitPrice: 1 })) }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [{ system: 'other', code: '1', name: 'X', quantity: 1, installedUnitPrice: 1 }] }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [{ system: 'ritm', code: '', name: 'X', quantity: 1, installedUnitPrice: 1 }] }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [{ system: 'ritm', code: '1', name: 'X', quantity: 1.5, installedUnitPrice: 1 }] }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [{ system: 'ritm', code: '1', name: 'X', quantity: 1, installedUnitPrice: -1 }] }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [{ system: 'ritm', code: '1', name: 'X', quantity: 1, installedUnitPrice: NaN }] }, { id: 'ritm', label: 'РИТМ' }],
    [{ ...valid, items: [valid.items[0], { system: 'other', code: '2', name: 'Broken', quantity: 1, installedUnitPrice: Infinity }] }, { id: 'ritm', label: 'РИТМ' }],
  ];
  for (const [proposal, group] of invalidCases) await assert.rejects(() => buildEstimateWorkbook(proposal, group), /invalid|обяз|quantity|price|item|group|proposal/i);
});

test('builder accepts only known ASCII catalog system IDs', async () => {
  const valid = fixture();
  for (const id of ['ritm', 'si-nord', 'hikvision', 'rental-used', 'other']) {
    const proposal = { ...valid, items: [{ ...valid.items[0], system: id }] };
    await assert.doesNotReject(() => buildEstimateWorkbook(proposal, { id, label: 'Система' }));
  }
  for (const id of ['', '../ritm', 'ritm/../hikvision', 'ritm\\evil', 'RITM', 'rіtm', 'ritm\n', 'unknown', 'si--nord']) {
    const proposal = { ...valid, items: [{ ...valid.items[0], system: id }] };
    await assert.rejects(() => buildEstimateWorkbook(proposal, { id, label: 'Система' }), /system|invalid/i, id || 'empty');
  }
  const contaminated = { ...valid, items: [valid.items[0], { ...valid.items[0], system: '../ritm', code: 'bad' }] };
  await assert.rejects(() => buildEstimateWorkbook(contaminated, { id: 'ritm', label: 'РИТМ' }), /system|invalid/i);
});

test('estimate filenames are Cyrillic, sanitized, bounded and deterministically unique', () => {
  const proposal = fixture();
  proposal.client.name = 'ООО \\:Клиент/*?"<>|\u0001 с очень длинным названием '.repeat(8);
  const name = estimateFilename(proposal, { id: 'ritm', label: 'РИТМ/Охрана' });
  assert.match(name, /^Смета ООО Клиент с очень длинным названием/);
  assert.match(name, /— РИТМОхрана\.xlsx$/);
  assert.doesNotMatch(name, /[\\/:*?"<>|\u0000-\u001F]/);
  assert.ok(name.length <= 140);
  assert.ok(Buffer.byteLength(name, 'utf8') <= 140);
  assert.deepEqual(uniqueEstimateFilenames(fixture(), [
    { id: 'one', label: 'Охрана/Видео' }, { id: 'two', label: 'Охрана:Видео' }, { id: 'three', label: 'Охрана:Видео' },
  ]), [
    'Смета ООО «Клиент» — ОхранаВидео.xlsx',
    'Смета ООО «Клиент» — ОхранаВидео (2).xlsx',
    'Смета ООО «Клиент» — ОхранаВидео (3).xlsx',
  ]);
});

test('filename allocator registers every final normalized name and always stays within 140 UTF-8 bytes', () => {
  const proposal = fixture();
  proposal.client.name = 'Клиент '.repeat(80);
  const groups = [
    { id: 'ritm', label: 'Система' },
    { id: 'si-nord', label: 'система' },
    { id: 'hikvision', label: 'Система (2)' },
    { id: 'rental-used', label: 'Систе\u0301ма' },
    { id: 'other', label: 'Систе́ма' },
    { id: 'ritm', label: 'Система/Видео' },
    { id: 'si-nord', label: 'Система:Видео' },
  ];
  const names = uniqueEstimateFilenames(proposal, groups);
  const normalized = names.map(name => name.normalize('NFC').toLocaleLowerCase('ru'));
  assert.equal(new Set(normalized).size, names.length);
  names.forEach(name => {
    assert.ok(name.endsWith('.xlsx'), name);
    assert.ok(name.length <= 140, name);
    assert.ok(Buffer.byteLength(name, 'utf8') <= 140, name);
  });
  assert.ok(names.some(name => /\(2\) \(2\)\.xlsx$/.test(name)), names.join('\n'));
});
