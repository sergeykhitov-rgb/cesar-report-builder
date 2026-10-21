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

function text(value, field, required = false, maxLength = MAX_TEXT, guardFormula = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw validationError(field + ' must be a scalar', field);
  const result = String(value).trim();
  if (required && !result) throw validationError(field + ' is required', field);
  if (result.length > maxLength) throw validationError(field + ' is too long', field);
  return guardFormula && FORMULA_PREFIX.test(result) ? "'" + result : result;
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
  const valueAt = (container, key, field) => {
    if (!plainObject(container)) throw validationError(field + ' is required', field);
    return money(container[key], field);
  };
  const manager = plainObject(proposal.manager) ? proposal.manager : {};
  const tariff = plainObject(computed.tariff) ? computed.tariff : {};
  const discountPercent = proposal.discountPercent == null ? 0 : money(proposal.discountPercent, 'discountPercent');
  if (discountPercent > 100) throw validationError('discountPercent must be between 0 and 100', 'discountPercent');
  const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const equipmentSubtotal = roundMoney(selected.items.reduce((sum, item) => sum + item.lineTotal, 0));
  const discountAmount = roundMoney(equipmentSubtotal * discountPercent / 100);
  const equipmentAfterDiscount = roundMoney(equipmentSubtotal - discountAmount);
  const installation = valueAt(computed.installation, 'final', 'computed.installation.final');
  return {
    ...selected,
    clientPhone: text(proposal.client.phone, 'client.phone', false, 100, false),
    clientEmail: text(proposal.client.email, 'client.email', false, 200, false),
    generatedAt: typeof proposal.generatedAt === 'string' && !Number.isNaN(Date.parse(proposal.generatedAt)) ? new Date(proposal.generatedAt) : new Date(),
    totals: {
      equipmentSubtotal,
      discountAmount,
      equipmentAfterDiscount,
      installation,
      oneTime: roundMoney(equipmentAfterDiscount + installation),
      monthlyFee: valueAt(computed.monthlyFee, 'final', 'computed.monthlyFee.final'),
      materialLiability: valueAt(computed.materialLiability, 'final', 'computed.materialLiability.final'),
    },
    discountPercent,
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

    const doc = new PDFDocument({ size: 'A4', margins: { top: 0, right: 0, bottom: -1000, left: 0 }, bufferPages: true, compress: false, info: { Title: 'Коммерческое предложение CESAR SATELLITE', Author: 'CESAR SATELLITE', Subject: data.groupLabel } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc.registerFont('Onest', FONT);
      doc.registerFont('Onest-Semibold', FONT);
      const left = 42, width = doc.page.width - 84, bottom = doc.page.height - 160;

      function font(size, bold = false, color = INK) { return doc.font(bold ? 'Onest-Semibold' : 'Onest').fontSize(size).fillColor(color); }
      function rule(y, color = LINE) { doc.save().strokeColor(color).lineWidth(0.7).moveTo(left, y).lineTo(left + width, y).stroke().restore(); }
      function header(continuation) {
        doc.x = left; doc.y = 35;
        if (fs.existsSync(LOGO)) doc.image(LOGO, left, 35, { width: 164 });
        font(8, true, RED).text(continuation ? 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ · ПРОДОЛЖЕНИЕ' : 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', left + 245, 43, { width: width - 245, height: 24, align: 'right', characterSpacing: 0.3, ellipsis: true, lineBreak: false });
        rule(82, RED); doc.y = 100;
      }
      function footer(pageNumber, totalPages) {
        const footerY = doc.page.height - 68; rule(footerY - 8);
        font(7.5, false, MUTED).text('CESAR SATELLITE', left, footerY, { width: width / 2, height: 12, lineBreak: false });
        font(7.5, false, MUTED).text('Страница ' + pageNumber + ' из ' + totalPages, left + width / 2, footerY, { width: width / 2, height: 12, align: 'right', lineBreak: false });
      }
      let pageNumber = 1;
      let addingPage = false;
      doc.on('pageAdded', () => {
        if (!addingPage) throw new Error('Unexpected automatic PDF page break');
      });
      function newPage() {
        addingPage = true;
        doc.addPage();
        addingPage = false;
        const range = doc.bufferedPageRange();
        doc.switchToPage(range.start + range.count - 1);
        pageNumber += 1;
        header(true);
        doc.x = left;
        doc.y = 100;
      }
      function ensure(height) { if (doc.y + height > bottom) newPage(); }
      function sectionTitle(title) { ensure(32); const y = doc.y; font(9, true, RED).text(title.toUpperCase(), left, y, { width, height: 14, characterSpacing: 1, lineBreak: false, ellipsis: true }); doc.y = y + 23; }
      function pair(label, value, x, y, pairWidth) {
        font(8, true, MUTED).text(label.toUpperCase(), x, y, { width: pairWidth, height: 12, characterSpacing: 0.4, lineBreak: false, ellipsis: true });
        font(10, false).text(value || '—', x, y + 14, { width: pairWidth, height: 48, lineGap: 2, ellipsis: true });
      }
      function tableHeader() {
        const y = doc.y; doc.save().fillColor(RED).roundedRect(left, y, width, 30, 5).fill().restore();
        const columns = [24, 52, 225, 42, 78, 90];
        const labels = ['№', 'Код', 'Наименование / модель', 'Кол-во', 'Цена', 'Сумма'];
        let x = left; font(7.3, true, '#ffffff');
        labels.forEach((label, index) => { doc.text(label, x + 4, y + 9, { width: columns[index] - 8, height: 16, align: index >= 3 ? 'right' : 'left', ellipsis: true, lineBreak: false }); x += columns[index]; });
        doc.y = y + 30;
      }
      function equipmentTable() {
        sectionTitle('Оборудование · ' + data.groupLabel); tableHeader();
        const columns = [24, 52, 225, 42, 78, 90];
        data.items.forEach((item, index) => {
          const rowHeight = item.model ? 44 : 32;
          if (doc.y + rowHeight > bottom) { newPage(); tableHeader(); }
          const y = doc.y;
          if (index % 2 === 1) doc.save().fillColor(SOFT).rect(left, y, width, rowHeight).fill().restore();
          const values = [String(index + 1), item.code, '', String(item.quantity), formatMoney(item.installedUnitPrice), formatMoney(item.lineTotal)];
          let x = left;
          values.forEach((value, column) => {
            if (column === 2) {
              font(8.2, true).text(item.name, x + 4, y + 7, { width: columns[column] - 8, height: 13, lineBreak: false, ellipsis: true });
              if (item.model) font(8.2).text(item.model, x + 4, y + 22, { width: columns[column] - 8, height: 13, lineBreak: false, ellipsis: true });
            } else {
              font(7.8).text(value, x + 4, y + 8, { width: columns[column] - 8, height: 13, align: column >= 3 ? 'right' : 'left', lineBreak: false, ellipsis: true });
            }
            x += columns[column];
          });
          doc.save().strokeColor(LINE).moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).stroke().restore(); doc.y = y + rowHeight;
        });
        doc.y += 14;
      }
      function moneyRow(label, value, strong) {
        ensure(26); const y = doc.y;
        font(9, strong, strong ? INK : MUTED).text(label, left, y, { width: width - 130, height: 16, lineBreak: false, ellipsis: true });
        font(strong ? 12 : 9, true, strong ? RED : INK).text(formatMoney(value), left + width - 130, y - (strong ? 2 : 0), { width: 130, height: 18, align: 'right', lineBreak: false, ellipsis: true });
        doc.y = y + (strong ? 28 : 22); if (!strong) rule(doc.y - 6);
      }
      function bulletList(items) {
        if (!items.length) { const y = doc.y; font(9, false, MUTED).text('Не выбраны', left, y, { width, height: 16, lineBreak: false }); doc.y = y + 22; return; }
        items.forEach(item => { const value = typeof item === 'string' ? item : item.title; const description = typeof item === 'string' ? '' : item.description; const descriptionHeight = description ? Math.min(44, doc.heightOfString(description, { width: width - 20, lineGap: 2 })) : 0; const itemHeight = 24 + descriptionHeight; ensure(itemHeight); const y = doc.y; font(9, true, RED).text('•', left, y, { width: 14, height: 14, lineBreak: false }); font(9, true).text(value, left + 16, y, { width: width - 16, height: 16, lineBreak: false, ellipsis: true }); if (description) font(8.5, false, MUTED).text(description, left + 16, y + 18, { width: width - 16, height: descriptionHeight, lineGap: 2, ellipsis: true }); doc.y = y + itemHeight; });
      }

      header(false); doc.x = left; doc.y = 100;
      let y = doc.y; font(25, true).text('Безопасность,\nкоторая работает', left, y, { width: width * 0.68, height: 66, lineGap: 1, ellipsis: true }); doc.y = y + 76;
      y = doc.y; font(10, false, MUTED).text('Индивидуальное предложение по охране объекта', left, y, { width, height: 16, lineBreak: false, ellipsis: true }); doc.y = y + 34; sectionTitle('Клиент и объект');
      const clientSummary = [data.clientName, data.clientPhone, data.clientEmail].filter(Boolean).join('\n');
      const infoY = doc.y; pair('Клиент', clientSummary, left, infoY, 245); pair('Адрес', data.metadata.address, left + 268, infoY, width - 268); doc.y = infoY + 68;
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
      y = doc.y; font(12, true).text(data.manager.name || '—', left, y, { width, height: 18, lineBreak: false, ellipsis: true }); doc.y = y + 20;
      if (data.manager.role) { y = doc.y; font(9, false, MUTED).text(data.manager.role, left, y, { width, height: 14, lineBreak: false, ellipsis: true }); doc.y = y + 16; }
      const contacts = [data.manager.phone, data.manager.email].filter(Boolean).join('  ·  '); if (contacts) { y = doc.y; font(9).text(contacts, left, y, { width, height: 14, lineBreak: false, ellipsis: true }); doc.y = y + 20; }
      y = doc.y; font(7.5, false, MUTED).text('Предложение сформировано ' + new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(data.generatedAt) + '. Итоговые условия уточняются при заключении договора.', left, y, { width, height: 30, lineGap: 2, ellipsis: true });

      const pages = doc.bufferedPageRange();
      for (let index = 0; index < pages.count; index += 1) {
        doc.switchToPage(pages.start + index);
        footer(index + 1, pages.count);
      }

      doc.end();
    } catch (error) { try { doc.end(); } catch {} reject(error); }
  });
}

module.exports = { MIME_PDF, buildProposalPdf, proposalFilename, uniqueProposalFilenames, normalizeProposal };
