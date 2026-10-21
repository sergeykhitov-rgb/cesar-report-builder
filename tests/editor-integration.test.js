const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = attributes;
    this.listeners = {};
    this.classList = { add() {}, remove() {} };
    this.value = '';
    this.innerHTML = '';
    this.hidden = false;
    this.textContent = '';
    this.disabled = false;
    this.children = [];
  }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  appendChild(child) { this.children.push(child); this.lastElementChild = child; return child; }
  insertBefore(child) { return this.appendChild(child); }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  select() {}
  click(type, event = {}) { return this.listeners[type](event); }
}

function createEditorHarness(savedDraft) {
  const elements = new Map();
  const managerInput = new FakeElement({ 'data-path': 'manager.name' });
  const cameraInput = new FakeElement({ 'data-path': 'proposal.counts.cameraCount' });
  const pathInputs = [managerInput, cameraInput];
  const storage = new Map([['cesar_report_draft_v2', JSON.stringify(savedDraft)]]);
  const renders = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '[data-path]') return pathInputs;
      return [];
    },
    createElement() { return new FakeElement(); },
    execCommand() { return true; },
  };
  const context = {
    console,
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); },
    },
    confirm() { return true; },
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    navigator: {},
    location: { origin: 'http://test.local' },
    fetch() { throw new Error('unexpected fetch'); },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('public/promotions.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('public/calculator-catalogs.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('public/calculator-engine.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('public/calculator.js', 'utf8'), context);
  context.renderReport = state => { renders.push(JSON.parse(JSON.stringify(state))); return ''; };
  vm.runInNewContext(fs.readFileSync('public/editor.js', 'utf8'), context);
  return { elements, managerInput, cameraInput, storage, renders };
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
