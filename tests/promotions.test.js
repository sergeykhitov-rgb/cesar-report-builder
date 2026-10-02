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
