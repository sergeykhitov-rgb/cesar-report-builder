'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  MIME_PDF,
  buildProposalPdf,
  proposalFilename,
  uniqueProposalFilenames,
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

function commandExists(name) {
  try { execFileSync('sh', ['-c', 'command -v "$1"', 'sh', name], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function extractText(buffer) {
  if (!commandExists('pdftotext')) return null;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cesar-pdf-test-'));
  const pdf = path.join(directory, 'proposal.pdf');
  fs.writeFileSync(pdf, buffer);
  return execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
}

test('buildProposalPdf creates a non-empty branded PDF for one equipment system', async () => {
  const buffer = await buildProposalPdf(fixture(), group());
  assert.equal(MIME_PDF, 'application/pdf');
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(buffer.length > 10_000);
  const text = extractText(buffer);
  if (text !== null) {
    ['КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', 'ООО «Северный дом»', 'Контрольная панель', 'Абонентская плата', 'Материальная ответственность', 'Два объекта выгоднее', 'Андрей Мешенков'].forEach(value => assert.match(text, new RegExp(value)));
    assert.doesNotMatch(text, /Камера|DS-2CD/);
  }
});

test('PDF export excludes internal metadata and spreadsheet formula prefixes remain plain text', async () => {
  const proposal = fixture({
    source: 'secret.xlsx', rawCatalogs: [{ secret: true }], overrideReason: 'secret reason',
    items: [{ system: 'ritm', systemLabel: 'РИТМ', code: '=CMD()', name: '+Панель', quantity: 1, installedUnitPrice: 1000 }],
  });
  const buffer = await buildProposalPdf(proposal, group());
  const text = extractText(buffer);
  if (text !== null) {
    assert.match(text, /=CMD\(\)|'\=CMD\(\)/);
    assert.doesNotMatch(text, /secret\.xlsx|secret reason|rawCatalogs|overrideReason/);
  }
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
