'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { validateAndSelect, validationError } = require('./xlsx-export');

const MIME_PDF = 'application/pdf';
const ROOT = path.resolve(__dirname, '..');
const FONT = path.join(ROOT, 'assets', 'fonts', 'Onest-Variable.ttf');
const LOGO = path.join(ROOT, 'public', 'logo.png');
const MAX_FILENAME = 140;
const MAX_TEXT = 500;
const MAX_MONEY = Number.MAX_SAFE_INTEGER;
const INVALID_FILENAME = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;
const FORMULA_PREFIX = /^[=+\-@]/;
const RED = '#e30613';
const INK = '#141519';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const SOFT = '#f5f6f8';

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function text(value, field, required = false, maxLength = MAX_TEXT) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw validationError(field + ' must be a scalar', field);
  const result = String(value).trim();
  if (required && !result) throw validationError(field + ' is required', field);
  if (result.length > maxLength) throw validationError(field + ' is too long', field);
  return FORMULA_PREFIX.test(result) ? "'" + result : result;
}

function money(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MONEY) {
    throw validationError(field + ' must be a finite non-negative safe amount', field);
  }
  return value;
}

function normalizeList(value, field, mapper, limit) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) throw validationError(field + ' must be an array with at most ' + limit + ' entries', field);
  return value.map(mapper);
}

function normalizeProposal(proposal, group) {
  const selected = validateAndSelect(proposal, group);
  const computed = plainObject(proposal.computed) ? proposal.computed : {};
  const equipment = plainObject(computed.equipment) ? computed.equipment : {};
  const valueAt = (container, key, field) => {
    if (!plainObject(container)) throw validationError(field + ' is required', field);
    return money(container[key], field);
  };
  const manager = plainObject(proposal.manager) ? proposal.manager : {};
  const tariff = plainObject(computed.tariff) ? computed.tariff : {};
  return {
    ...selected,
    generatedAt: typeof proposal.generatedAt === 'string' && !Number.isNaN(Date.parse(proposal.generatedAt)) ? new Date(proposal.generatedAt) : new Date(),
    totals: {
      equipmentSubtotal: money(equipment.subtotal, 'computed.equipment.subtotal'),
      discountAmount: money(equipment.discountAmount, 'computed.equipment.discountAmount'),
      equipmentAfterDiscount: money(equipment.afterDiscount, 'computed.equipment.afterDiscount'),
      installation: valueAt(computed.installation, 'final', 'computed.installation.final'),
      oneTime: valueAt(computed.oneTime, 'final', 'computed.oneTime.final'),
      monthlyFee: valueAt(computed.monthlyFee, 'final', 'computed.monthlyFee.final'),
      materialLiability: valueAt(computed.materialLiability, 'final', 'computed.materialLiability.final'),
    },
    discountPercent: proposal.discountPercent == null ? 0 : money(proposal.discountPercent, 'discountPercent'),
    tariff: text(tariff.resolvedName, 'computed.tariff.resolvedName', false, 200),
    options: normalizeList(proposal.selectedOptionNames, 'selectedOptionNames', (item, index) => text(item, 'selectedOptionNames.' + index, true, 200), 100),
    promotions: normalizeList(proposal.promotions, 'promotions', (item, index) => {
      if (!plainObject(item)) throw validationError('promotion must be a plain object', 'promotions.' + index);
      return { title: text(item.title, 'promotions.' + index + '.title', true, 200), description: text(item.description, 'promotions.' + index + '.description', false, 700) };
    }, 50),
    manager: {
      name: text(manager.name, 'manager.name', false, 200), role: text(manager.role, 'manager.role', false, 200),
      phone: text(manager.phone, 'manager.phone', false, 100), email: text(manager.email, 'manager.email', false, 200),
    },
  };
}

function safeFilenamePart(value, fallback) {
  const result = String(value || '').normalize('NFC').replace(INVALID_FILENAME, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return result || fallback;
}

function truncateUtf8(value, maxBytes) {
  let output = '', bytes = 0;
  for (const character of String(value)) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    output += character; bytes += size;
  }
  return output.trimEnd().replace(/[. ]+$/g, '');
}

function proposalFilenameWithMarker(proposal, group, marker) {
  const client = safeFilenamePart(proposal && proposal.client && proposal.client.name, 'Клиент');
  const system = safeFilenamePart(group && (group.label || group.id), 'Система');
  const prefix = 'КП ', separator = ' — ', extension = '.pdf', collision = marker || '';
  const available = Math.max(2, MAX_FILENAME - Buffer.byteLength(prefix + separator + collision + extension, 'utf8'));
  const clientBytes = Buffer.byteLength(client, 'utf8'), systemBytes = Buffer.byteLength(system, 'utf8');
  let clientBudget = clientBytes, systemBudget = systemBytes;
  if (clientBytes + systemBytes > available) {
    systemBudget = Math.min(systemBytes, Math.floor(available / 2));
    clientBudget = Math.min(clientBytes, available - systemBudget);
    systemBudget = Math.min(systemBytes, available - clientBudget);
  }
  return prefix + truncateUtf8(client, clientBudget) + separator + truncateUtf8(system, systemBudget) + collision + extension;
}

function proposalFilename(proposal, group) { return proposalFilenameWithMarker(proposal, group, ''); }

function uniqueProposalFilenames(proposal, groups) {
  const used = new Set();
  return groups.map(group => {
    for (let number = 1; ; number += 1) {
      const marker = number === 1 ? '' : ' (' + number + ')';
      const candidate = proposalFilenameWithMarker(proposal, group, marker);
      const key = candidate.normalize('NFC').toLocaleLowerCase('ru');
      if (!used.has(key)) { used.add(key); return candidate; }
    }
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value) + ' ₽';
}

function buildProposalPdf(proposal, group) {
  return new Promise((resolve, reject) => {
    let data;
    try { data = normalizeProposal(proposal, group); }
    catch (error) { reject(error); return; }
    if (!fs.existsSync(FONT)) { reject(new Error('Bundled Onest font is missing')); return; }

    const doc = new PDFDocument({ size: 'A4', margins: { top: 42, right: 42, bottom: 0, left: 42 }, bufferPages: true, info: { Title: 'Коммерческое предложение CESAR SATELLITE', Author: 'CESAR SATELLITE', Subject: data.groupLabel } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc.registerFont('Onest', FONT);
      doc.registerFont('Onest-Semibold', FONT);
      const left = 42, width = doc.page.width - 84, bottom = doc.page.height - 90;
      let tableContinuation = false;

      function font(size, bold = false, color = INK) { return doc.font(bold ? 'Onest-Semibold' : 'Onest').fontSize(size).fillColor(color); }
      function rule(y, color = LINE) { doc.save().strokeColor(color).lineWidth(0.7).moveTo(left, y).lineTo(left + width, y).stroke().restore(); }
      function header(continuation) {
        doc.x = left; doc.y = 35;
        if (fs.existsSync(LOGO)) doc.image(LOGO, left, 35, { width: 164 });
        font(8, true, RED).text(continuation ? 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ · ПРОДОЛЖЕНИЕ' : 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', left + 245, 43, { width: width - 245, height: 24, align: 'right', characterSpacing: 0.3, ellipsis: true, lineBreak: false });
        rule(82, RED); doc.y = 100;
      }
      function newPage() { doc.addPage(); doc.y = 100; }
      function ensure(height, continuation = false) { if (doc.y + height > bottom) newPage(continuation); }
      function sectionTitle(title) { ensure(38); font(9, true, RED).text(title.toUpperCase(), left, doc.y, { characterSpacing: 1 }); doc.moveDown(0.45); }
      function pair(label, value, x, y, pairWidth) {
        font(8, true, MUTED).text(label.toUpperCase(), x, y, { width: pairWidth, characterSpacing: 0.4 });
        font(10, false).text(value || '—', x, y + 14, { width: pairWidth, lineGap: 2 });
      }
      function tableHeader() {
        const y = doc.y; doc.save().fillColor(RED).roundedRect(left, y, width, 30, 5).fill().restore();
        const columns = [24, 52, 225, 42, 78, 90];
        const labels = ['№', 'Код', 'Наименование / модель', 'Кол-во', 'Цена', 'Сумма'];
        let x = left; font(7.3, true, '#ffffff');
        labels.forEach((label, index) => { doc.text(label, x + 4, y + 9, { width: columns[index] - 8, height: 16, align: index >= 3 ? 'right' : 'left', ellipsis: true }); x += columns[index]; });
        doc.y = y + 30;
      }
      function equipmentTable() {
        sectionTitle('Оборудование · ' + data.groupLabel); tableHeader();
        const columns = [24, 52, 225, 42, 78, 90];
        data.items.forEach((item, index) => {
          font(8.2);
          const name = item.name + (item.model ? '\n' + item.model : '');
          const rowHeight = Math.max(32, doc.heightOfString(name, { width: columns[2] - 8, lineGap: 1 }) + 13);
          if (doc.y + rowHeight > bottom) { newPage(true); tableHeader(); tableContinuation = true; }
          const y = doc.y;
          if (index % 2 === 1) doc.save().fillColor(SOFT).rect(left, y, width, rowHeight).fill().restore();
          const values = [String(index + 1), item.code, name, String(item.quantity), formatMoney(item.installedUnitPrice), formatMoney(item.lineTotal)];
          let x = left; values.forEach((value, column) => { font(column === 2 ? 8.2 : 7.8, column === 2); doc.text(value, x + 4, y + 8, { width: columns[column] - 8, height: rowHeight - 12, align: column >= 3 ? 'right' : 'left', lineGap: 1, ellipsis: true }); x += columns[column]; });
          doc.save().strokeColor(LINE).moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).stroke().restore(); doc.y = y + rowHeight;
        });
        doc.moveDown(0.8);
      }
      function moneyRow(label, value, strong) {
        ensure(26); const y = doc.y;
        font(9, strong, strong ? INK : MUTED).text(label, left, y, { width: width - 130 });
        font(strong ? 12 : 9, true, strong ? RED : INK).text(formatMoney(value), left + width - 130, y - (strong ? 2 : 0), { width: 130, align: 'right' });
        doc.y = y + (strong ? 28 : 22); if (!strong) rule(doc.y - 6);
      }
      function bulletList(items) {
        if (!items.length) { font(9, false, MUTED).text('Не выбраны'); doc.moveDown(0.5); return; }
        items.forEach(item => { const value = typeof item === 'string' ? item : item.title; const description = typeof item === 'string' ? '' : item.description; ensure(34 + doc.heightOfString(description || '', { width: width - 20 })); font(9, true, RED).text('•', left, doc.y, { width: 14 }); font(9, true).text(value, left + 16, doc.y, { width: width - 16 }); if (description) { font(8.5, false, MUTED).text(description, left + 16, doc.y + 2, { width: width - 16, lineGap: 2 }); } doc.moveDown(0.45); });
      }

      doc.on('pageAdded', function () { header(true); });
      header(false);
      font(25, true).text('Безопасность,\nкоторая работает', left, doc.y, { width: width * 0.68, lineGap: 1 });
      doc.moveDown(0.45); font(10, false, MUTED).text('Индивидуальное предложение по охране объекта', left, doc.y, { width });
      doc.moveDown(1.4); sectionTitle('Клиент и объект');
      const infoY = doc.y; pair('Клиент', data.clientName, left, infoY, 245); pair('Адрес', data.metadata.address, left + 268, infoY, width - 268); doc.y = infoY + 54;
      pair('PIN', data.metadata.pin, left, doc.y, 150); pair('Лицевой счёт', data.metadata.account, left + 170, doc.y, 150); pair('Счёт', data.metadata.invoice, left + 340, doc.y, width - 340); doc.y += 55;
      equipmentTable();
      ensure(520, true);
      sectionTitle('Разовые итоги');
      moneyRow('Оборудование до скидки', data.totals.equipmentSubtotal, false);
      if (data.totals.discountAmount > 0) moneyRow('Скидка' + (data.discountPercent ? ' ' + data.discountPercent + '%' : ''), data.totals.discountAmount, false);
      moneyRow('Оборудование со скидкой', data.totals.equipmentAfterDiscount, false);
      moneyRow('Монтаж', data.totals.installation, false); moneyRow('Итого разово', data.totals.oneTime, true);
      sectionTitle('Ежемесячные условия');
      moneyRow('Абонентская плата' + (data.tariff ? ' · ' + data.tariff : ''), data.totals.monthlyFee, false);
      moneyRow('Материальная ответственность', data.totals.materialLiability, false);
      sectionTitle('Дополнительные опции'); bulletList(data.options);
      sectionTitle('Выбранные акции'); bulletList(data.promotions);
      sectionTitle('Ваш менеджер');
      font(12, true).text(data.manager.name || '—');
      if (data.manager.role) { font(9, false, MUTED).text(data.manager.role); }
      const contacts = [data.manager.phone, data.manager.email].filter(Boolean).join('  ·  '); if (contacts) { font(9).text(contacts); }
      doc.moveDown(0.8); font(7.5, false, MUTED).text('Предложение сформировано ' + new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(data.generatedAt) + '. Итоговые условия уточняются при заключении договора.', { width, lineGap: 2 });

      const range = doc.bufferedPageRange();
      for (let page = 0; page < range.count; page += 1) {
        doc.switchToPage(range.start + page);
        const footerY = doc.page.height - 68; rule(footerY - 8);
        font(7.5, false, MUTED).text('CESAR SATELLITE', left, footerY, { width: width / 2, lineBreak: false });
        font(7.5, false, MUTED).text('Страница ' + (page + 1) + ' из ' + range.count, left + width / 2, footerY, { width: width / 2, align: 'right', lineBreak: false });
      }
      void tableContinuation;
      doc.end();
    } catch (error) { try { doc.end(); } catch {} reject(error); }
  });
}

module.exports = { MIME_PDF, buildProposalPdf, proposalFilename, uniqueProposalFilenames, normalizeProposal };
