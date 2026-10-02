# Promotions Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 14-item multi-select promotions catalog with unique Nano Banana imagery to the CESAR SATELLITE report builder and public report.

**Architecture:** Keep the promotions catalog in a standalone browser-safe module, store only selected promotion snapshots in report state, and render them through the existing shared report renderer. Generate and optimize 14 local image assets so previews, public links, mobile layouts, and PDF printing do not depend on external media URLs.

**Tech Stack:** Vanilla JavaScript, CSS, Node.js built-in test runner, Higgsfield CLI with Nano Banana 2 Lite, existing dependency-free Node server.

---

## File map

- Create `public/promotions.js`: immutable catalog of 14 client-facing promotions.
- Create `public/assets/promotions/*.webp`: 14 optimized promotion images.
- Create `tests/promotions.test.js`: catalog, renderer, and backward-compatibility tests.
- Modify `public/index.html`: promotions editor section and catalog script loading.
- Modify `public/editor.js`: selection, local overrides, persistence, and reset behavior.
- Modify `public/editor.css`: selectable promotion cards and responsive editor grid.
- Modify `public/report-render.js`: promotions section renderer.
- Modify `public/theme.css`: public report cards, print behavior, and responsive layout.
- Modify `public/report.html`: load the catalog before the renderer.
- Modify `package.json`: add `npm test`.

### Task 1: Test harness and promotions catalog

**Files:**
- Create: `tests/promotions.test.js`
- Create: `public/promotions.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing catalog tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function loadScript(file, context = {}) {
  context.window = context;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context;
}

test('catalog contains 14 unique client promotions', () => {
  const ctx = loadScript('public/promotions.js');
  assert.equal(ctx.CESAR_PROMOTIONS.length, 14);
  assert.equal(new Set(ctx.CESAR_PROMOTIONS.map(x => x.id)).size, 14);
  ctx.CESAR_PROMOTIONS.forEach(x => {
    assert.match(x.image, /^\/assets\/promotions\/[a-z0-9-]+\.webp$/);
    assert.ok(x.title.length > 3);
    assert.ok(x.description.length > 15);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test tests/promotions.test.js`

Expected: FAIL because `public/promotions.js` does not exist.

- [ ] **Step 3: Create the catalog module**

```js
(function (global) {
  global.CESAR_PROMOTIONS = Object.freeze([
    { id: 'two-objects', title: 'Два объекта выгоднее', description: 'Скидка 20% на общую ежемесячную абонентскую плату при одновременном подключении двух и более объектов.', image: '/assets/promotions/two-objects.webp' },
    { id: 'refer-friend', title: 'Приведи друга', description: 'Месяц абонентской платы в подарок за каждого нового клиента по рекомендации.', image: '/assets/promotions/refer-friend.webp' },
    { id: 'reactivation', title: 'Возвращайтесь на выгодных условиях', description: 'При возобновлении обслуживания оплаченный период от четырёх месяцев удваивается по условиям акции.', image: '/assets/promotions/reactivation.webp' },
    { id: 'prepayment', title: 'Выгодная предоплата', description: 'Специальные условия при оплате 9 или 12 месяцев обслуживания вперёд.', image: '/assets/promotions/prepayment.webp' },
    { id: 'equipment-discount', title: 'Комплект и дополнительные устройства', description: 'Скидка 15% на оборудование при дополнительном подключении услуг.', image: '/assets/promotions/equipment-discount.webp' },
    { id: 'same-day-install', title: 'Установка в день обращения', description: 'Скидка 10% при планировании установки в день обращения.', image: '/assets/promotions/same-day-install.webp' },
    { id: 'three-cameras', title: 'Видеонаблюдение от трёх камер', description: 'Обслуживание охранной системы без дополнительной платы при подключении видеоохраны от трёх камер.', image: '/assets/promotions/three-cameras.webp' },
    { id: 'competitor-estimate', title: 'Предложение лучше сметы конкурента', description: 'Индивидуальное ценовое предложение при наличии действующей сметы другой охранной компании.', image: '/assets/promotions/competitor-estimate.webp' },
    { id: 'repair-certificate', title: 'Сертификат на ремонт', description: 'Сертификат номиналом 5 000 рублей для клиентов в течение двух месяцев после ремонта.', image: '/assets/promotions/repair-certificate.webp' },
    { id: 'easy-move', title: 'Лёгкий переезд', description: 'Специальные условия переноса охранной системы на новый объект.', image: '/assets/promotions/easy-move.webp' },
    { id: 'first-month-free', title: 'Первый месяц бесплатно', description: 'Скидка 100% на абонентскую плату в течение первых 30 дней.', image: '/assets/promotions/first-month-free.webp' },
    { id: 'switch-free', title: 'Переключение оборудования за 0 рублей', description: 'Подключение совместимого оборудования другой охранной компании без платы за переключение.', image: '/assets/promotions/switch-free.webp' },
    { id: 'safe-box', title: 'Сейф-бокс по специальной цене', description: 'Сейф-бокс за 1 500 рублей вместо 4 200 рублей.', image: '/assets/promotions/safe-box.webp' },
    { id: 'rental-zero', title: 'Оборудование в аренду за 0 рублей', description: 'Базовый или выгодный комплект для квартиры, коттеджа или малого бизнеса предоставляется в аренду без платы за оборудование при соблюдении условий акции.', image: '/assets/promotions/rental-zero.webp' }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Add the test script and run tests**

Add to `package.json`:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test tests/*.test.js"
}
```

Run: `npm test`

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add package.json public/promotions.js tests/promotions.test.js
git commit -m "feat: add promotions catalog"
```

### Task 2: Generate and optimize 14 images

**Files:**
- Create: `public/assets/promotions/*.webp`

- [ ] **Step 1: Verify Higgsfield authentication and discover models**

Run:

```bash
higgsfield account status
higgsfield model list --json
higgsfield model get nano_banana_2_lite --json
```

Expected: authenticated account and schema showing supported image parameters.

- [ ] **Step 2: Generate each horizontal image**

For each catalog item, use the shared style suffix below and a unique scene prompt:

```text
premium minimalist Russian advertising photography, contemporary Russia, clean light neutral background, realistic materials, restrained CESAR SATELLITE red and yellow accents, ample negative space, crisp commercial lighting, horizontal composition, no text, no letters, no numbers, no logos, no watermark, no foreign signage
```

Command pattern:

```bash
higgsfield generate create nano_banana_2_lite \
  --prompt "<unique scene>. <shared style suffix>" \
  --aspect_ratio 16:9 \
  --wait --json
```

Use these unique scenes in catalog order: two connected Russian properties; two friends recommending security; returning homeowner reactivating a system; advance-payment calendar and secure home; modular alarm kit with extra sensors; installer arriving the same day; three discreet cameras around a Russian home; two commercial estimates with the better one selected; renovated apartment and gift envelope; family moving security equipment to a new apartment; protected home with first-month gift motif; technician connecting existing compatible equipment; compact premium safe-box; rental alarm kit serving apartment, cottage, and small shop.

- [ ] **Step 3: Download results to deterministic filenames**

Save the primary result from each job to the exact path declared by the catalog, for example:

```bash
curl -L "<result-url>" -o public/assets/promotions/two-objects.png
```

- [ ] **Step 4: Normalize all images**

Run with bundled Python and Pillow:

```python
from pathlib import Path
from PIL import Image, ImageOps

root = Path('public/assets/promotions')
for src in root.glob('*.png'):
    image = Image.open(src).convert('RGB')
    image = ImageOps.fit(image, (1280, 720), method=Image.Resampling.LANCZOS)
    image.save(src.with_suffix('.webp'), 'WEBP', quality=84, method=6)
```

Expected: 14 WebP files, each 1280×720 and below 500 KB where practical.

- [ ] **Step 5: Visually inspect all 14 images**

Create a 4-column contact sheet and inspect it at full resolution. Regenerate any image with text, foreign signage, visual artifacts, wrong geography, or inconsistent style.

- [ ] **Step 6: Extend the catalog test to verify assets**

```js
const path = require('node:path');
ctx.CESAR_PROMOTIONS.forEach(x => {
  assert.ok(fs.existsSync(path.join('public', x.image)));
});
```

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/assets/promotions tests/promotions.test.js
git commit -m "feat: add promotion artwork"
```

### Task 3: Add multi-select editor UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/editor.js`
- Modify: `public/editor.css`

- [ ] **Step 1: Add a failing source-contract test**

```js
test('editor exposes promotions selection container', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(html, /id="promotions"/);
  assert.match(html, /src="\/promotions\.js"/);
});
```

Run: `npm test`

Expected: FAIL because the container and script are absent.

- [ ] **Step 2: Add the form section and script ordering**

Insert after the summary form group:

```html
<div class="fgroup">
  <div class="fgroup-h">
    <span class="label-red">Акции</span>
    <span class="fgroup-hint">можно выбрать несколько</span>
  </div>
  <div id="promotions" class="promo-picker"></div>
</div>
```

Load `promotions.js` before `report-render.js` and `editor.js`.

- [ ] **Step 3: Add promotion state and rendering**

Add `promotions: []` to `DEFAULT`. Implement `renderPromotions()` that maps `window.CESAR_PROMOTIONS`, checks whether each id exists in `state.promotions`, and creates a button-like card. On selection, push a snapshot `{ id, title, description, image }`; on deselection, remove it. Selected cards contain editable title and description inputs whose events stop propagation and update only the snapshot.

- [ ] **Step 4: Style the selector**

Add a two-column `.promo-picker` grid, 16:9 thumbnails, red selected border, visible checkmark, and one-column behavior below 640 px. Ensure editable fields only appear for selected cards.

- [ ] **Step 5: Run tests and manual editor check**

Run: `npm test`

Expected: PASS.

Open the editor and verify selecting, editing, deselecting, resetting, and localStorage persistence.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/editor.js public/editor.css tests/promotions.test.js
git commit -m "feat: add promotions multi-select editor"
```

### Task 4: Render promotions in reports

**Files:**
- Modify: `public/report-render.js`
- Modify: `public/theme.css`
- Modify: `public/report.html`
- Test: `tests/promotions.test.js`

- [ ] **Step 1: Add failing renderer tests**

```js
test('renderer includes only selected promotions', () => {
  const ctx = loadScript('public/report-render.js');
  const html = ctx.renderReport({ promotions: [{ id: 'x', title: 'Акция X', description: 'Описание', image: '/x.webp' }] });
  assert.match(html, /Специальные предложения/);
  assert.match(html, /Акция X/);
  assert.match(html, /\/x\.webp/);
});

test('renderer omits promotions section for legacy reports', () => {
  const ctx = loadScript('public/report-render.js');
  assert.doesNotMatch(ctx.renderReport({ title: 'Старый отчёт' }), /Специальные предложения/);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test`

Expected: first renderer test FAILS.

- [ ] **Step 3: Implement the shared renderer**

Add a `promotions(d)` function that filters valid selected items, escapes all user-editable text, and returns section heading plus `.rp-promotions` cards. Insert it between `stats(d)` and `events(d)` in `renderReport()`.

- [ ] **Step 4: Add report styles**

Use a two-column grid, 16:9 image, compact red eyebrow, 16 px title, restrained body copy, card border and soft shadow. Add `break-inside: avoid` for print and one column below 640 px.

- [ ] **Step 5: Ensure public page loads catalog script**

Load `/promotions.js` before `/report-render.js` in `public/report.html`.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add public/report-render.js public/theme.css public/report.html tests/promotions.test.js
git commit -m "feat: render selected promotions in reports"
```

### Task 5: End-to-end and visual verification

**Files:**
- Modify if needed: `seed/demo.json`

- [ ] **Step 1: Run automated tests and syntax checks**

```bash
npm test
node --check public/promotions.js
node --check public/editor.js
node --check public/report-render.js
node --check server.js
```

Expected: all commands exit 0.

- [ ] **Step 2: Start the local server**

Run: `npm start`

Expected: server listens on port 4600.

- [ ] **Step 3: Verify desktop and mobile flows**

Select several promotions, edit one title, add an event, publish, and open the generated report. Verify the chosen ordering and copy in desktop and 375 px mobile layouts.

- [ ] **Step 4: Verify all 14 and no-selection states**

Create one report with all 14 promotions and another with none. Confirm the first contains 14 cards and the second has no promotions heading.

- [ ] **Step 5: Verify print/PDF**

Print the all-promotions report to PDF and confirm images and their text stay together, colors remain visible, and there are no clipped cards.

- [ ] **Step 6: Check existing permanent demo**

Open `/r/demo` and confirm it still renders without errors even though it has no promotions array.

- [ ] **Step 7: Final commit**

```bash
git add seed/demo.json public tests package.json
git commit -m "test: verify promotions report flow"
```
