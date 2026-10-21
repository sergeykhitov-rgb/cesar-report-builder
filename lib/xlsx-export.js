'use strict';

const ExcelJS = require('exceljs');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_FILENAME = 140;
const MAX_TEXT = 500;
const INVALID_FILENAME = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;
const FORMULA_PREFIX = /^[=+\-@]/;
const RUBLES = '#,##0\ "₽"';
const KNOWN_SYSTEM_IDS = new Set(['ritm', 'si-nord', 'hikvision', 'rental-used', 'other']);
const MAX_QUANTITY = 1_000_000;
const MAX_UNIT_PRICE = 1_000_000_000_000;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function scalarText(value, field, required, maxLength) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw validationError(field + ' must be a scalar');
  const text = String(value).trim();
  if (required && !text) throw validationError(field + ' is required');
  if (text.length > (maxLength || MAX_TEXT)) throw validationError(field + ' is too long');
  return FORMULA_PREFIX.test(text) ? "'" + text : text;
}

function validationError(message, path) {
  const error = new Error('Invalid export: ' + message);
  error.code = 'INVALID_EXPORT';
  error.path = path || '';
  return error;
}

function validateSystemId(value, path) {
  const field = path || 'system';
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || !KNOWN_SYSTEM_IDS.has(value)) {
    throw validationError('system must be a known catalog ID', field);
  }
  return value;
}

function validateAndSelect(proposal, group) {
  if (!plainObject(proposal)) throw validationError('proposal must be a plain object', 'proposal');
  if (!plainObject(group)) throw validationError('group must be a plain object', 'group');
  const groupId = validateSystemId(group.id, 'group.id');
  const groupLabel = scalarText(group.label, 'group.label', true, 160);
  if (!plainObject(proposal.client)) throw validationError('client is required', 'proposal.client');
  const clientName = scalarText(proposal.client.name, 'client.name', true, 200);
  if (!Array.isArray(proposal.items) || proposal.items.length < 1 || proposal.items.length > 200) {
    throw validationError('items must contain 1..200 entries', 'proposal.items');
  }
  const normalizedItems = proposal.items.map((item, index) => {
    const path = 'proposal.items.' + index;
    if (!plainObject(item)) throw validationError('item must be a plain object', path);
    const system = validateSystemId(item.system, path + '.system');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) throw validationError('quantity must be an integer from 1 to 1000000', path + '.quantity');
    if (typeof item.installedUnitPrice !== 'number' || !Number.isFinite(item.installedUnitPrice) || item.installedUnitPrice < 0 || item.installedUnitPrice > MAX_UNIT_PRICE) throw validationError('price must be between 0 and 1000000000000', path + '.installedUnitPrice');
    const lineTotal = item.quantity * item.installedUnitPrice;
    if (!Number.isFinite(lineTotal) || lineTotal > Number.MAX_SAFE_INTEGER) throw validationError('line total must be finite and at most Number.MAX_SAFE_INTEGER', path + '.lineTotal');
    return {
      system,
      code: scalarText(item.code, path + '.code', true, 100),
      name: scalarText(item.name, path + '.name', true, 300),
      model: scalarText(item.model, path + '.model', false, 200),
      unit: scalarText(item.unit == null ? 'шт.' : item.unit, path + '.unit', true, 30),
      quantity: item.quantity,
      installedUnitPrice: item.installedUnitPrice,
      lineTotal,
    };
  });
  const items = normalizedItems.filter(item => item.system === groupId);
  if (!items.length) throw validationError('item system must match group', 'proposal.items');
  const accumulatedTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isFinite(accumulatedTotal) || accumulatedTotal > Number.MAX_SAFE_INTEGER) throw validationError('accumulated total must be finite and at most Number.MAX_SAFE_INTEGER', 'proposal.items');
  const object = plainObject(proposal.object) ? proposal.object : {};
  return {
    clientName,
    groupId,
    groupLabel,
    items,
    metadata: {
      pin: scalarText(object.pin, 'object.pin', false, 100),
      account: scalarText(object.account, 'object.account', false, 100),
      invoice: scalarText(object.invoice, 'object.invoice', false, 100),
      address: scalarText(object.address, 'object.address', false, 300),
    },
  };
}

function safeFilenamePart(value, fallback) {
  const cleaned = String(value || '').normalize('NFC').replace(INVALID_FILENAME, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return cleaned || fallback;
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

function estimateFilenameWithMarker(proposal, group, marker) {
  const client = safeFilenamePart(proposal && proposal.client && proposal.client.name, 'Клиент');
  const system = safeFilenamePart(group && (group.label || group.id), 'Система');
  const prefix = 'Смета ';
  const separator = ' — ';
  const extension = '.xlsx';
  const collision = marker || '';
  const fixedBytes = Buffer.byteLength(prefix + separator + collision + extension, 'utf8');
  const available = Math.max(2, MAX_FILENAME - fixedBytes);
  const clientBytes = Buffer.byteLength(client, 'utf8');
  const systemBytes = Buffer.byteLength(system, 'utf8');
  let clientBudget, systemBudget;
  if (clientBytes + systemBytes <= available) {
    clientBudget = clientBytes; systemBudget = systemBytes;
  } else {
    systemBudget = Math.min(systemBytes, Math.floor(available / 2));
    clientBudget = Math.min(clientBytes, available - systemBudget);
    systemBudget = Math.min(systemBytes, available - clientBudget);
  }
  return prefix + truncateUtf8(client, clientBudget) + separator + truncateUtf8(system, systemBudget) + collision + extension;
}

function estimateFilename(proposal, group) {
  return estimateFilenameWithMarker(proposal, group, '');
}

function uniqueEstimateFilenames(proposal, groups) {
  const used = new Set();
  return groups.map(group => {
    let number = 1;
    while (true) {
      const marker = number === 1 ? '' : ' (' + number + ')';
      const candidate = estimateFilenameWithMarker(proposal, group, marker);
      const key = candidate.normalize('NFC').toLocaleLowerCase('ru');
      if (!used.has(key)) { used.add(key); return candidate; }
      number += 1;
    }
  });
}

function styleMetadata(sheet, rowNumber, label, value) {
  sheet.mergeCells(rowNumber, 1, rowNumber, 2);
  sheet.mergeCells(rowNumber, 3, rowNumber, 8);
  const labelCell = sheet.getCell(rowNumber, 1);
  const valueCell = sheet.getCell(rowNumber, 3);
  labelCell.value = label;
  valueCell.value = value || '—';
  labelCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF555555' } };
  valueCell.font = { name: 'Arial', size: 10, color: { argb: 'FF202020' } };
  valueCell.alignment = { wrapText: true, vertical: 'top' };
}

async function buildEstimateWorkbook(proposal, group) {
  const data = validateAndSelect(proposal, group);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CESAR SATELLITE';
  workbook.created = proposal.generatedAt && !Number.isNaN(Date.parse(proposal.generatedAt)) ? new Date(proposal.generatedAt) : new Date();
  const sheet = workbook.addWorksheet('Смета', {
    properties: { defaultRowHeight: 18 },
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });

  sheet.mergeCells('A1:H1');
  const title = sheet.getCell('A1');
  title.value = 'Спецификация';
  title.font = { name: 'Arial', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 34;
  styleMetadata(sheet, 2, 'Клиент / заказчик', data.clientName);
  styleMetadata(sheet, 3, 'PIN', data.metadata.pin);
  styleMetadata(sheet, 4, 'Лицевой счёт / счёт', [data.metadata.account, data.metadata.invoice].filter(Boolean).join(' · '));
  styleMetadata(sheet, 5, 'Адрес', data.metadata.address);
  styleMetadata(sheet, 6, 'Система', data.groupLabel);
  styleMetadata(sheet, 7, 'Дата формирования', new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(workbook.created));

  const headerRowNumber = 9;
  const headers = ['№', 'Код', 'Наименование оборудования', 'Модель', 'Ед. изм.', 'Кол-во', 'Цена оборудования с установкой за единицу, руб. с НДС', 'Стоимость оборудования с установкой за количество, руб. с НДС.'];
  const header = sheet.getRow(headerRowNumber);
  header.values = headers;
  header.height = 54;
  header.eachCell(cell => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF202020' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD400' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FF777777' } }, left: { style: 'thin', color: { argb: 'FF777777' } }, bottom: { style: 'thin', color: { argb: 'FF777777' } }, right: { style: 'thin', color: { argb: 'FF777777' } } };
  });

  const firstDataRow = headerRowNumber + 1;
  data.items.forEach((item, index) => {
    const rowNumber = firstDataRow + index;
    const total = item.lineTotal;
    const row = sheet.getRow(rowNumber);
    row.values = [index + 1, item.code, item.name, item.model, item.unit, item.quantity, item.installedUnitPrice, { formula: `F${rowNumber}*G${rowNumber}`, result: total }];
    row.height = 32;
    row.eachCell(cell => {
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF202020' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FFCCCCCC' } }, left: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } }, right: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });
    row.getCell(1).alignment = row.getCell(5).alignment = row.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(6).numFmt = '0';
    row.getCell(7).numFmt = row.getCell(8).numFmt = RUBLES;
  });

  const lastDataRow = firstDataRow + data.items.length - 1;
  const totalRowNumber = lastDataRow + 1;
  sheet.mergeCells(totalRowNumber, 1, totalRowNumber, 7);
  const totalLabel = sheet.getCell(totalRowNumber, 1);
  totalLabel.value = 'ИТОГО';
  totalLabel.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
  totalLabel.alignment = { horizontal: 'right', vertical: 'middle' };
  const result = data.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalCell = sheet.getCell(totalRowNumber, 8);
  totalCell.value = { formula: `SUM(H${firstDataRow}:H${lastDataRow})`, result };
  totalCell.numFmt = RUBLES;
  totalCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
  totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
  [totalLabel, totalCell].forEach(cell => { cell.border = { top: { style: 'thin', color: { argb: 'FFC8102E' } }, left: { style: 'thin', color: { argb: 'FFC8102E' } }, bottom: { style: 'thin', color: { argb: 'FFC8102E' } }, right: { style: 'thin', color: { argb: 'FFC8102E' } } }; });

  [5, 14, 34, 22, 10, 10, 22, 25].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber, activeCell: `A${firstDataRow}` }];
  sheet.autoFilter = { from: `A${headerRowNumber}`, to: `H${lastDataRow}` };
  sheet.pageSetup.printArea = `A1:H${totalRowNumber}`;
  sheet.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;
  sheet.headerFooter.oddFooter = '&L CESAR SATELLITE&CСтраница &P из &N&R' + data.groupLabel;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { MIME_XLSX, buildEstimateWorkbook, estimateFilename, uniqueEstimateFilenames, validateSystemId, validationError };
