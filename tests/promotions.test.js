const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function loadScript(file, context = {}) {
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context;
}

test('catalog contains 14 unique client promotions', () => {
  const ctx = loadScript('public/promotions.js');
  assert.equal(ctx.CESAR_PROMOTIONS.length, 14);
  assert.equal(new Set(ctx.CESAR_PROMOTIONS.map((item) => item.id)).size, 14);
  ctx.CESAR_PROMOTIONS.forEach((item) => {
    assert.match(item.image, /^\/assets\/promotions\/[a-z0-9-]+\.webp$/);
    assert.ok(item.title.length > 3);
    assert.ok(item.description.length > 15);
  });
});

test('catalog image assets exist', () => {
  const ctx = loadScript('public/promotions.js');
  ctx.CESAR_PROMOTIONS.forEach((item) => {
    assert.ok(fs.existsSync(`public${item.image}`), `Missing ${item.image}`);
  });
});

test('editor exposes promotions selection container', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(html, /id="promotions"/);
  assert.match(html, /src="\/promotions\.js"/);
});

test('renderer includes only selected promotions', () => {
  const ctx = loadScript('public/report-render.js');
  const html = ctx.renderReport({
    promotions: [{ id: 'x', title: 'Акция X', description: 'Описание акции', image: '/x.webp' }]
  });
  assert.match(html, /Специальные предложения/);
  assert.match(html, /Акция X/);
  assert.match(html, /\/x\.webp/);
});

test('renderer omits promotions section for legacy reports', () => {
  const ctx = loadScript('public/report-render.js');
  assert.doesNotMatch(ctx.renderReport({ title: 'Старый отчёт' }), /Специальные предложения/);
});

test('report promotions collapse to a fluid single column on mobile', () => {
  const css = fs.readFileSync('public/theme.css', 'utf8');
  assert.match(css, /\.report\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.rp-promotions\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.rp-promo\s*\{[^}]*min-width:\s*0/s);
});

test('print layout keeps cards and report footer together', () => {
  const css = fs.readFileSync('public/theme.css', 'utf8');
  assert.match(css, /@media\s+print[\s\S]*\.rp-promo\s*\{[^}]*break-inside:\s*avoid/);
  assert.match(css, /@media\s+print[\s\S]*\.rp-foot\s*\{[^}]*break-inside:\s*avoid/);
});
