const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function loadScript(file, context = {}) {
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context;
}

test('official equipment sources have verified local copies', () => {
  const manifest = JSON.parse(
    fs.readFileSync('public/assets/promotions/references/official-sources.json', 'utf8')
  );
  const requiredSources = ['security-kit', 'security-sticker', 'motion-sensor', 'keypad'];

  assert.deepEqual(Object.keys(manifest).sort(), requiredSources.sort());
  requiredSources.forEach((name) => {
    const source = manifest[name];
    assert.match(source.url, /^https:\/\/www\.csat\.ru\/storage\/media\//);
    const contents = fs.readFileSync(source.path);
    const sha256 = crypto.createHash('sha256').update(contents).digest('hex');
    assert.equal(sha256, source.sha256, `${name} SHA-256 mismatch`);
  });
});

test('corrected promotion outputs are exactly 1280x720', () => {
  const files = ['switch-free.webp', 'rental-zero.webp', 'two-objects.webp'];

  files.forEach((file) => {
    const dimensions = execFileSync(
      'python3',
      ['-c', 'from PIL import Image; import sys; print(*Image.open(sys.argv[1]).size)', `public/assets/promotions/${file}`],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(dimensions, '1280 720', `${file} must be 1280x720`);
  });
});

test('authentic promotions compositor uses every official equipment source', () => {
  const compositor = fs.readFileSync('scripts/compose-authentic-promotions.py', 'utf8');
  const requiredSources = [
    'security-kit.png',
    'security-sticker.webp',
    'motion-sensor.webp',
    'keypad.webp'
  ];

  requiredSources.forEach((source) => assert.match(compositor, new RegExp(source.replace('.', '\\.'))));
});

test('promotion optimizer excludes compositor helper images', () => {
  const optimizer = fs.readFileSync('scripts/optimize-promotions.py', 'utf8');
  assert.match(optimizer, /switch-free-background\.png/);
  assert.match(optimizer, /two-objects-base\.png/);
});

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
