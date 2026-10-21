'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFParse } = require('pdf-parse');
const {
  MIME_PDF,
  buildProposalPdf,
  proposalFilename,
  uniqueProposalFilenames,
  normalizeProposal,
} = require('../lib/pdf-export');

function fixture(overrides = {}) {
  return {
    client: { name: 'ООО «Северный дом»' },
    object: { pin: '123456', account: 'ЛС-77', invoice: 'СЧ-42', address: 'г. Москва, ул. Тверская, 1' },
    generatedAt: '2026-10-21T12:00:00.000Z',
    items: [
      { system: 'ritm', systemLabel: 'РИТМ', code: 'R-1', name: 'Контрольная панель', model: 'Контакт GSM-5', unit: 'шт.', quantity: 2, installedUnitPrice: 15000, lineTotal: 30000 },
      { system: 'hikvision', systemLabel: 'ОхранаВидео', code: 'H-1', name: 'Камера', model: 'DS-2CD', unit: 'шт.', quantity: 1, installedUnitPrice: 20000, lineTotal: 20000 },
    ],
    discountPercent: 10,
    computed: {
      equipment: { subtotal: 50000, discountAmount: 5000, afterDiscount: 45000 },
      installation: { final: 7000 }, oneTime: { final: 52000 },
      monthlyFee: { final: 3500 }, materialLiability: { final: 100000 },
      tariff: { resolvedName: 'Бизнес-3500' },
    },
    selectedOptionNames: ['Тревожная кнопка', 'Видеоверификация'],
    promotions: [{ title: 'Два объекта выгоднее', description: 'Скидка 20% на второй объект.' }],
    manager: { name: 'Андрей Мешенков', role: 'Персональный менеджер', phone: '+7 495 785-53-53', email: 'manager@example.test' },
    ...overrides,
  };
}

function group(id = 'ritm', label = 'РИТМ') { return { id, label }; }

async function extractText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try { return (await parser.getText()).text; }
  finally { await parser.destroy(); }
}

test('buildProposalPdf creates a non-empty branded PDF for one equipment system', async () => {
  const buffer = await buildProposalPdf(fixture(), group());
  assert.equal(MIME_PDF, 'application/pdf');
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(buffer.length > 10_000);
  const text = await extractText(buffer);
  ['КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', 'ООО «Северный дом»', 'Контрольная панель', 'Абонентская плата', 'Материальная ответственность', 'Два объекта выгоднее', 'Андрей Мешенков'].forEach(value => assert.match(text, new RegExp(value)));
  assert.doesNotMatch(text, /Камера|DS-2CD/);
});

test('PDF export excludes internal metadata and spreadsheet formula prefixes remain plain text', async () => {
  const proposal = fixture({
    source: 'secret.xlsx', rawCatalogs: [{ secret: true }], overrideReason: 'secret reason',
    items: [{ system: 'ritm', systemLabel: 'РИТМ', code: '=CMD()', name: '+Панель', quantity: 1, installedUnitPrice: 1000 }],
  });
  const buffer = await buildProposalPdf(proposal, group());
  const text = await extractText(buffer);
  assert.match(text, /=CMD\(\)|'\=CMD\(\)/);
  assert.doesNotMatch(text, /secret\.xlsx|secret reason|rawCatalogs|overrideReason/);
});

test('proposal filenames are safe, bounded and unique under label collisions', () => {
  const unsafe = fixture({ client: { name: '../ООО:\u0000 «Клиент»' } });
  const name = proposalFilename(unsafe, { id: 'ritm', label: 'РИТМ/Москва' });
  assert.ok(name.endsWith('.pdf'));
  assert.doesNotMatch(name, /[\\/:*?"<>|\u0000-\u001F]/);
  assert.ok(Buffer.byteLength(name, 'utf8') <= 140);
  const names = uniqueProposalFilenames(unsafe, [
    { id: 'ritm', label: 'Система' }, { id: 'hikvision', label: 'система' }, { id: 'si-nord', label: 'Система (2)' },
  ]);
  assert.equal(new Set(names.map(value => value.normalize('NFC').toLocaleLowerCase('ru'))).size, 3);
});

test('PDF builder rejects unknown systems, invalid numbers and mismatched groups', async () => {
  await assert.rejects(() => buildProposalPdf(fixture({ items: [{ system: '../ritm', code: '1', name: 'Панель', quantity: 1, installedUnitPrice: 1 }] }), group()), /known catalog ID/i);
  await assert.rejects(() => buildProposalPdf(fixture({ items: [{ system: 'ritm', code: '1', name: 'Панель', quantity: 1_000_001, installedUnitPrice: 1 }] }), group()), /quantity/i);
  await assert.rejects(() => buildProposalPdf(fixture(), group('si-nord', 'Си-Норд')), /match group/i);
});

test('each equipment system receives its own discounted equipment and one-time totals', () => {
  const proposal = fixture();
  const ritm = normalizeProposal(proposal, group('ritm', 'РИТМ'));
  const video = normalizeProposal(proposal, group('hikvision', 'ОхранаВидео'));
  assert.deepEqual(ritm.totals, {
    equipmentSubtotal: 30000, discountAmount: 3000, equipmentAfterDiscount: 27000,
    installation: 7000, oneTime: 34000, monthlyFee: 3500, materialLiability: 100000,
  });
  assert.deepEqual(video.totals, {
    equipmentSubtotal: 20000, discountAmount: 2000, equipmentAfterDiscount: 18000,
    installation: 7000, oneTime: 25000, monthlyFee: 3500, materialLiability: 100000,
  });
  assert.notEqual(ritm.totals.equipmentSubtotal, proposal.computed.equipment.subtotal);
  assert.notEqual(ritm.totals.oneTime, proposal.computed.oneTime.final);
});

test('money remains bounded and is calculated in integer kopecks', () => {
  const boundary = normalizeProposal(fixture({
    items: [{ system: 'ritm', systemLabel: 'РИТМ', code: 'MAX', name: 'Граница', quantity: 1, installedUnitPrice: 1_000_000_000_000 }],
    discountPercent: 12.345,
    computed: { ...fixture().computed, installation: { final: 0.01 }, monthlyFee: { final: 1_000_000_000_000 }, materialLiability: { final: 1_000_000_000_000 } },
  }), group());
  assert.equal(Number.isSafeInteger(boundary.totals.equipmentSubtotal * 100), true);
  assert.equal(Number.isSafeInteger(boundary.totals.discountAmount * 100), true);
  assert.equal(boundary.totals.discountAmount, 123_450_000_000);
  assert.equal(boundary.totals.equipmentAfterDiscount, 876_550_000_000);
  assert.equal(boundary.totals.oneTime, 876_550_000_000.01);
});

test('money rejects out-of-range inputs and computed overflow', () => {
  assert.throws(() => normalizeProposal(fixture({
    items: [{ system: 'ritm', systemLabel: 'РИТМ', code: 'OVER', name: 'Переполнение', quantity: 1, installedUnitPrice: 1_000_000_000_000.01 }],
  }), group()), /price|money|amount|safe/i);
  assert.throws(() => normalizeProposal(fixture({
    items: [{ system: 'ritm', systemLabel: 'РИТМ', code: 'MAX', name: 'Граница', quantity: 1, installedUnitPrice: 1_000_000_000_000 }],
    discountPercent: 0,
    computed: { ...fixture().computed, installation: { final: 0.01 } },
  }), group()), /oneTime|total|money|amount|safe/i);
  assert.throws(() => normalizeProposal(fixture({ computed: { ...fixture().computed, monthlyFee: { final: 1_000_000_000_000.01 } } }), group()), /monthlyFee|money|amount|safe/i);
});

test('client contacts are strictly normalized and included only when supplied', () => {
  const populated = normalizeProposal(fixture({ client: { name: 'ООО «Северный дом»', phone: '+7 999 111-22-33', email: 'client@example.test' } }), group());
  assert.equal(populated.clientPhone, '+7 999 111-22-33');
  assert.equal(populated.clientEmail, 'client@example.test');
  const empty = normalizeProposal(fixture(), group());
  assert.equal(empty.clientPhone, '');
  assert.equal(empty.clientEmail, '');
  assert.throws(() => normalizeProposal(fixture({ client: { name: 'Клиент', phone: { secret: true } } }), group()), /client\.phone.*scalar/i);
  assert.throws(() => normalizeProposal(fixture({ client: { name: 'Клиент', email: 'x'.repeat(201) } }), group()), /client\.email.*too long/i);
});

test('a long proposal creates continuation pages with repeated logo and table header drawing operations', async () => {
  const items = Array.from({ length: 70 }, (_, index) => ({ system: 'ritm', systemLabel: 'РИТМ', code: 'R-' + index, name: 'Длинное наименование охранного оборудования ' + index, model: 'Модель ' + index, unit: 'шт.', quantity: 1, installedUnitPrice: 1000 }));
  const buffer = await buildProposalPdf(fixture({ items }), group());
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    assert.ok(parsed.total >= 4, 'expected at least four PDF pages');
    parsed.pages.slice(1).forEach(page => assert.match(page.text, /КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ · ПРОДОЛЖЕНИЕ/));
    parsed.pages.filter(page => /R-\d+/.test(page.text)).forEach(page => assert.match(page.text, /Наименование \/ модель/));
  } finally { await parser.destroy(); }
});
