const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = attributes;
    this.listeners = {};
    this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) };
    this.value = '';
    this.innerHTML = '';
    this.hidden = false;
    this.textContent = '';
    this.disabled = false;
    this.children = [];
  }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  appendChild(child) { child.parentElement = this; this.children.push(child); this.lastElementChild = child; return child; }
  remove() { this.removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  insertBefore(child) { return this.appendChild(child); }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  focus() { this.focused = true; }
  select() {}
  click(type, event = {}) { if (type === undefined) { this.programmaticClicked = true; return; } return this.listeners[type](event); }
}

function createEditorHarness(savedDraft, options = {}) {
  const elements = new Map();
  const managerInput = new FakeElement({ 'data-path': 'manager.name' });
  const cameraInput = new FakeElement({ 'data-path': 'proposal.counts.cameraCount' });
  const pathInputs = [managerInput, cameraInput];
  const rawDraft = typeof savedDraft === 'string' ? savedDraft : JSON.stringify(savedDraft);
  const storage = new Map([['cesar_report_draft_v2', rawDraft]]);
  const renders = [];
  let fetchCalls = 0;
  const fetchBodies = [];
  const fetchRequests = [];
  const createdElements = [];
  const selectorElements = new Map();
  const documentListeners = {};
  const timerCallbacks = [];
  const body = new FakeElement();
  const document = {
    body,
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '[data-path]') return pathInputs;
      return [];
    },
    querySelector(selector) { if (!selectorElements.has(selector)) selectorElements.set(selector, new FakeElement()); return selectorElements.get(selector); },
    createElement(tagName) { const element = new FakeElement(); element.tagName = String(tagName || '').toUpperCase(); createdElements.push(element); return element; },
    execCommand() { return true; },
    addEventListener(type, listener) { documentListeners[type] = listener; },
    removeEventListener(type, listener) { if (documentListeners[type] === listener) delete documentListeners[type]; },
    dispatch(type, event) { if (documentListeners[type]) documentListeners[type](event); },
  };
  const context = {
    console,
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); },
    },
    confirm() { return true; },
    setTimeout(fn) { if (options.deferTimers) { timerCallbacks.push(fn); return timerCallbacks.length; } fn(); return 1; },
    clearTimeout() {},
    navigator: {},
    location: { origin: 'http://test.local' },
    matchMedia() { return { matches: !!options.mobile }; },
    Blob,
    URL: { createObjectURL(blob) { context.lastObjectUrlBlob = blob; return 'blob:test'; }, revokeObjectURL(url) { context.revokedObjectUrl = url; } },
    fetch(url, fetchOptions) {
      fetchCalls += 1;
      fetchRequests.push({ url, options: fetchOptions });
      fetchBodies.push(JSON.parse(fetchOptions.body));
      if (options.fetch) return options.fetch(url, fetchOptions);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'report-1' }) });
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('public/promotions.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('public/calculator-catalogs.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('public/calculator-engine.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('public/calculator.js', 'utf8'), context);
  context.renderReport = state => { renders.push(JSON.parse(JSON.stringify(state))); return ''; };
  vm.runInNewContext(fs.readFileSync('public/editor.js', 'utf8'), context);
  return { elements, selectorElements, document, managerInput, cameraInput, storage, renders, fetchBodies, fetchRequests, createdElements, context, fetchCalls: () => fetchCalls, runTimers() { while (timerCallbacks.length) timerCallbacks.shift()(); } };
}

test('editor deep-merges an incomplete legacy draft and reset has independent defaults', () => {
  const harness = createEditorHarness({
    title: 'Legacy',
    object: { pin: '123' },
    summary: { alarms: '2' },
    promotions: [],
    events: [],
  });
  const loaded = harness.renders.at(-1);
  assert.equal(loaded.object.pin, '123');
  assert.equal(loaded.object.owner, '');
  assert.equal(loaded.summary.alarms, '2');
  assert.equal(loaded.summary.incidents, '');
  assert.equal(loaded.manager.name, 'Мешенков Андрей');

  harness.managerInput.value = 'Mutated manager';
  harness.managerInput.click('input');
  assert.equal(JSON.parse(harness.storage.get('cesar_report_draft_v2')).manager.name, 'Mutated manager');

  harness.elements.get('btnReset').click('click');
  const reset = JSON.parse(harness.storage.get('cesar_report_draft_v2'));
  assert.equal(reset.manager.name, 'Мешенков Андрей');
  assert.equal(reset.object.pin, '');
  assert.notStrictEqual(reset.manager, loaded.manager);
});

test('editor input-path mutation recalculates and saves normalized proposal state', () => {
  const harness = createEditorHarness({ promotions: [], events: [] });
  harness.cameraInput.value = '3';
  harness.cameraInput.click('input');

  const saved = JSON.parse(harness.storage.get('cesar_report_draft_v2'));
  assert.equal(saved.proposal.counts.cameraCount, 3);
  assert.equal(saved.proposal.computed.tariff.resolvedName, 'Видео Базовый');
  assert.equal(saved.proposal.computed.monthlyFee.final, 2800);
});

test('future proposal schema blocks editor writes and preserves raw localStorage byte-for-byte', () => {
  const raw = '{"title":"Future draft","proposal":{"schemaVersion":2,"client":{"name":"Keep me"}},"promotions":[],"events":[]}';
  const harness = createEditorHarness(raw);
  const warning = harness.elements.get('toast');

  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /более новой версии/i);
  assert.match(warning.textContent, /обновите/i);

  harness.managerInput.value = 'Attempted mutation';
  harness.managerInput.click('input');
  harness.elements.get('btnReset').click('click');
  harness.elements.get('btnGenerate').click('click');

  assert.equal(harness.storage.get('cesar_report_draft_v2'), raw);
  assert.equal(harness.fetchCalls(), 0);
  assert.equal(warning.hidden, false);
});

test('generate posts only the client-safe report projection', async () => {
  const harness = createEditorHarness({
    promotions: [], events: [],
    proposal: {
      client: { name: 'ООО Тест' },
      items: [{ system: 'ritm', code: '1', name: 'Датчик', quantity: 1, installedUnitPrice: 1000, sourceInstalledUnitPrice: 900, priceOverridden: true }],
      overrides: { monthlyFeeOverride: 1 },
    },
  });
  harness.elements.get('btnGenerate').click('click');
  await new Promise(resolve => setImmediate(resolve));
  const json = JSON.stringify(harness.fetchBodies[0]);
  assert.equal(harness.fetchCalls(), 1);
  ['sourceInstalledUnitPrice', 'priceOverridden', 'overrides', 'warnings', 'exportMetadata', 'identity'].forEach(key => assert.doesNotMatch(json, new RegExp(`"${key}"`)));
  assert.match(json, /ООО Тест/);
});

test('generate blocks an invalid proposal before POST and focuses its first invalid control', () => {
  const harness = createEditorHarness({ promotions: [], events: [], proposal: { client: { name: '' }, items: [] } });
  harness.elements.get('btnGenerate').click('click');
  assert.equal(harness.fetchCalls(), 0);
  const client = harness.elements.get('proposalClientName');
  assert.equal(client.focused, true);
  assert.match(harness.elements.get('toast').textContent, /клиент/i);
});

test('success dialog and mobile preview move focus, close on Escape, and restore their triggers', async () => {
  const harness = createEditorHarness({
    promotions: [], events: [],
    proposal: { client: { name: 'ООО Тест' }, items: [{ system: 'ritm', code: '1', name: 'Датчик', quantity: 1, installedUnitPrice: 1000 }] },
  }, { mobile: true });
  const generate = harness.elements.get('btnGenerate');
  generate.click('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.elements.get('modal').hidden, false);
  assert.equal(harness.elements.get('linkInput').focused, true);
  assert.equal(harness.selectorElements.get('.workspace').inert, true);
  harness.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(harness.elements.get('modal').hidden, true);
  assert.equal(generate.focused, true);
  assert.equal(harness.selectorElements.get('.workspace').inert, false);

  const previewTrigger = harness.elements.get('btnPreviewMobile');
  previewTrigger.click('click');
  const preview = harness.elements.get('panePreview');
  assert.equal(preview.getAttribute('role'), 'dialog');
  assert.equal(preview.getAttribute('aria-modal'), 'true');
  assert.equal(harness.elements.get('btnClosePreview').focused, true);
  harness.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(preview.classList.contains('open'), false);
  assert.equal(preview.hasAttribute('role'), false);
  assert.equal(previewTrigger.focused, true);
});

test('XLSX export enables only for a valid proposal while PDF stays disabled', () => {
  const valid = createEditorHarness({
    promotions: [], events: [], object: { pin: '11', address: 'Москва' },
    proposal: { client: { name: 'ООО Тест' }, items: [{ system: 'ritm', systemLabel: 'РИТМ', code: '1', name: 'Датчик', quantity: 1, installedUnitPrice: 1000 }] },
  });
  assert.equal(valid.elements.get('btnExportXlsx').disabled, false);
  assert.equal(valid.elements.get('btnExportPdf').disabled, true);

  const invalid = createEditorHarness({ promotions: [], events: [], proposal: { client: { name: '' }, items: [] } });
  assert.equal(invalid.elements.get('btnExportXlsx').disabled, true);
  assert.equal(invalid.elements.get('btnExportPdf').disabled, true);
});

test('XLSX export posts a minimal safe payload, downloads response filename and restores busy state', async () => {
  const harness = createEditorHarness({
    promotions: [], events: [], object: { pin: '11', address: 'Москва', owner: 'Не для сметы' },
    proposal: {
      client: { name: 'ООО Тест', phone: '+7', email: 'mail@example.test' },
      items: [{ system: 'ritm', systemLabel: 'РИТМ', code: '1', name: 'Датчик', model: 'M', unit: 'шт.', quantity: 1, installedUnitPrice: 1000, sourceInstalledUnitPrice: 900, priceOverridden: true }],
      exportMetadata: { internal: true }, overrides: { monthlyFeeOverride: 1 },
    },
  }, { fetch: () => Promise.resolve({
    ok: true,
    headers: { get(name) { return name.toLowerCase() === 'content-disposition' ? "attachment; filename=\"estimate.xlsx\"; filename*=UTF-8''%D0%A1%D0%BC%D0%B5%D1%82%D0%B0%20%D0%A2%D0%B5%D1%81%D1%82.xlsx" : null; } },
    blob: () => Promise.resolve(new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
  }), deferTimers: true });
  const button = harness.elements.get('btnExportXlsx');
  button.click('click');
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /Готовим/);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.fetchRequests[0].url, '/api/exports/xlsx');
  const payload = harness.fetchBodies[0];
  assert.equal(payload.client.name, 'ООО Тест');
  assert.equal(payload.object.pin, '11');
  assert.equal(payload.items[0].installedUnitPrice, 1000);
  const json = JSON.stringify(payload);
  ['phone', 'email', 'owner', 'sourceInstalledUnitPrice', 'priceOverridden', 'exportMetadata', 'overrides', 'warnings', 'exportGroups'].forEach(key => assert.doesNotMatch(json, new RegExp(`"${key}"`)));
  const anchor = harness.createdElements.find(element => element.tagName === 'A');
  assert.equal(anchor.download, 'Смета Тест.xlsx');
  assert.equal(anchor.programmaticClicked, true);
  assert.ok(harness.document.body.children.includes(anchor));
  assert.equal(anchor.removed, undefined);
  assert.equal(harness.context.revokedObjectUrl, undefined, 'object URL remains valid through the click turn');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Смета XLSX');
  harness.runTimers();
  assert.equal(anchor.removed, true);
  assert.equal(harness.document.body.children.includes(anchor), false);
  assert.equal(harness.context.revokedObjectUrl, 'blob:test');
});

test('XLSX export shows server validation error and restores button after a 422 response', async () => {
  const harness = createEditorHarness({
    promotions: [], events: [], proposal: { client: { name: 'ООО Тест' }, items: [{ system: 'ritm', systemLabel: 'РИТМ', code: '1', name: 'Датчик', quantity: 1, installedUnitPrice: 1000 }] },
  }, { fetch: () => Promise.resolve({ ok: false, status: 422, json: () => Promise.resolve({ errors: [{ message: 'Некорректная цена.' }] }) }) });
  const button = harness.elements.get('btnExportXlsx');
  button.click('click');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(harness.elements.get('toast').textContent, /Некорректная цена/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Смета XLSX');
});

test('XLSX export handles a network failure without leaving the button busy', async () => {
  const harness = createEditorHarness({
    promotions: [], events: [], proposal: { client: { name: 'ООО Тест' }, items: [{ system: 'ritm', systemLabel: 'РИТМ', code: '1', name: 'Датчик', quantity: 1, installedUnitPrice: 1000 }] },
  }, { fetch: () => Promise.reject(new Error('offline')) });
  const button = harness.elements.get('btnExportXlsx');
  button.click('click');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(harness.elements.get('toast').textContent, /соединение/i);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Смета XLSX');
});
