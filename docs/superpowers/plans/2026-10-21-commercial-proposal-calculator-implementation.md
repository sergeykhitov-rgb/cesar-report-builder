# Commercial Proposal Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready CESAR SATELLITE commercial-proposal calculator with imported Excel catalogs, automatic and overridable pricing, priority promotions, separate PDF proposals, and separate XLSX estimates per equipment system.

**Architecture:** Convert the supplied Excel workbooks into versioned JSON catalogs, then run all business rules through a pure browser/server-compatible calculation engine. The existing editor owns user input and live preview; the Node server owns durable reports and binary exports. PDF and XLSX builders consume one normalized calculation snapshot so every output reconciles to the screen.

**Tech Stack:** Node.js 18, browser JavaScript, Python 3 with `xlrd`/`openpyxl` for repeatable source import, Node test runner, ExcelJS, PDFKit with bundled Onest fonts, existing HTML/CSS application.

---

### Task 1: Import and validate the source catalogs

**Files:**
- Create: `scripts/import-calculator-data.py`
- Create: `data/catalogs/calculator.json`
- Create: `data/catalogs/equipment.json`
- Create: `data/catalogs/import-manifest.json`
- Create: `tests/calculator-import.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing catalog-contract tests**

Create `tests/calculator-import.test.js` that loads the three JSON files and verifies source hashes, required sections, numeric prices, unique equipment keys, and the known control values:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const calculator = JSON.parse(fs.readFileSync('data/catalogs/calculator.json'));
const equipment = JSON.parse(fs.readFileSync('data/catalogs/equipment.json'));
const manifest = JSON.parse(fs.readFileSync('data/catalogs/import-manifest.json'));

test('calculator catalogs contain control values', () => {
  assert.equal(calculator.materialLiability.b2c.apartment.basic, 1000000);
  assert.equal(calculator.materialLiability.b2c.apartment.value, 1500000);
  assert.equal(calculator.materialLiability.b2c.apartment.premium, 2000000);
  assert.equal(calculator.options.find(x => x.name === 'Видеокамера для Cesar Home').monthlyPrice, 250);
});

test('equipment rows have unique source keys and numeric prices', () => {
  const keys = equipment.items.map(x => x.system + ':' + x.code);
  assert.equal(new Set(keys).size, keys.length);
  equipment.items.forEach(x => {
    assert.ok(x.code);
    assert.ok(x.name);
    assert.ok(Number.isFinite(x.installedUnitPrice));
  });
});

test('import manifest records all source workbooks', () => {
  assert.equal(manifest.sources.length, 3);
  manifest.sources.forEach(x => assert.match(x.sha256, /^[a-f0-9]{64}$/));
});
```

- [ ] **Step 2: Run tests and confirm the red state**

Run: `npm test -- tests/calculator-import.test.js`

Expected: FAIL because the catalog JSON files do not exist.

- [ ] **Step 3: Implement repeatable import**

Create a Python importer that accepts explicit paths, reads `.xlsx` with `openpyxl` and `.xls` with `xlrd`, normalizes whitespace and numeric values, records source workbook/sheet/row, and rejects duplicate `(system, code)` keys with different data. Use this stable public contract:

```python
def import_sources(reference_path, template_path, filled_example_path, output_dir):
    calculator = read_calculator_reference(reference_path)
    equipment = read_equipment_template(template_path)
    validate_calculator(calculator)
    validate_equipment(equipment)
    write_json(output_dir / "calculator.json", calculator)
    write_json(output_dir / "equipment.json", equipment)
    write_manifest(output_dir, [reference_path, template_path, filled_example_path])
```

Normalize system names to stable IDs: `ritm`, `si-nord`, `hikvision`, `rental-used`, and `other`. Preserve the original sheet name and label for display. Skip blank rows and rows with no code. Keep zero prices as valid values.

- [ ] **Step 4: Run importer against the supplied files**

Run:

```bash
python3 scripts/import-calculator-data.py \
  --reference "/Users/sergejhitev/Downloads/Справочники_калькулятора_НДВ_00000002.xlsx" \
  --template "/Users/sergejhitev/Downloads/Спецификация_НДВ_для кальк окт.xls" \
  --example "/Users/sergejhitev/Downloads/Копия Спецификация_НДВ_6065286.xls" \
  --output data/catalogs
```

Expected: three JSON files and a summary containing row counts per source sheet.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

Commit:

```bash
git add scripts/import-calculator-data.py data/catalogs tests/calculator-import.test.js .gitignore
git commit -m "feat: import calculator catalogs from source workbooks"
```

### Task 2: Build the pure calculation engine

**Files:**
- Create: `public/calculator-engine.js`
- Create: `tests/calculator-engine.test.js`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing business-rule tests**

Cover line totals, discounts, automatic B2C transitions, video tariffs, rental rules, manual zero overrides, missing-rate warnings, material liability, and grouping by equipment system:

```js
test('manual zero override is preserved', () => {
  const result = engine.calculate(baseInput({ monthlyFeeOverride: 0 }));
  assert.equal(result.monthlyFee.final, 0);
  assert.equal(result.monthlyFee.overridden, true);
});

test('camera switches B2C tariff and adds each extra camera', () => {
  const result = engine.calculate(baseInput({ tariff: 'Базовый', cameraCount: 3 }));
  assert.equal(result.tariff.resolvedName, 'Видео Базовый');
  assert.equal(result.monthlyFee.options, 500);
});

test('B2B rental applies at least fifteen percent', () => {
  const result = engine.calculate(baseB2B({ rent: true, baseMonthlyFee: 5000 }));
  assert.equal(result.monthlyFee.calculated, 5750);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/calculator-engine.test.js`

Expected: FAIL because `calculator-engine.js` is missing.

- [ ] **Step 3: Implement the engine as pure functions**

Expose a UMD-compatible API so Node tests and the browser use the same code:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CesarCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function applyOverride(calculated, override) {
    const hasOverride = override !== '' && override !== null && override !== undefined;
    return { calculated, override: hasOverride ? Number(override) : null,
      final: hasOverride ? Number(override) : calculated, overridden: hasOverride };
  }
  function groupEquipment(items) {
    return items.filter(item => Number(item.quantity) > 0).reduce((groups, item) => {
      const id = item.system;
      let group = groups.find(candidate => candidate.id === id);
      if (!group) {
        group = { id, label: item.systemLabel || id, items: [] };
        groups.push(group);
      }
      group.items.push(item);
      return groups;
    }, []);
  }
  function calculate(input, catalogs) {
    const equipment = (input.items || []).filter(item => Number(item.quantity) > 0)
      .map(item => ({ ...item, lineTotal: Number(item.quantity) * Number(item.installedUnitPrice) }));
    const equipmentSubtotal = equipment.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = equipmentSubtotal * Number(input.discountPercent || 0) / 100;
    const monthlyCalculated = Number(input.baseMonthlyFee || 0) + Number(input.monthlyOptions || 0);
    return {
      equipment,
      oneTime: { equipmentSubtotal, discount, final: equipmentSubtotal - discount },
      monthlyFee: applyOverride(monthlyCalculated, input.monthlyFeeOverride),
      materialLiability: applyOverride(Number(input.materialLiability || 0), input.materialLiabilityOverride),
      warnings: [],
      exportGroups: groupEquipment(equipment)
    };
  }
  return { calculate, applyOverride, groupEquipment };
});
```

Return one normalized snapshot with `equipment`, `oneTime`, `monthlyFee`, `materialLiability`, `tariff`, `warnings`, and `exportGroups`. Do not replace missing rates with zero.

- [ ] **Step 4: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

Commit:

```bash
git add public/calculator-engine.js public/index.html tests/calculator-engine.test.js
git commit -m "feat: add commercial proposal calculation engine"
```

### Task 3: Add calculator state and priority promotions

**Files:**
- Create: `public/calculator.js`
- Create: `public/calculator-catalogs.js`
- Modify: `public/editor.js`
- Modify: `public/promotions.js`
- Modify: `public/index.html`
- Create: `tests/calculator-state.test.js`

- [ ] **Step 1: Add failing state and promotion tests**

Assert that the default draft contains calculator input, that the three required promotions are selected and ordered first, and that resetting an override restores the calculated value.

```js
test('priority promotions are the first three defaults', () => {
  const ctx = loadScript('public/promotions.js');
  assert.deepEqual(ctx.CESAR_PRIORITY_PROMOTIONS, [
    'two-objects', 'refer-friend', 'prepayment'
  ]);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/calculator-state.test.js`

Expected: FAIL because priority metadata and calculator state are missing.

- [ ] **Step 3: Implement state integration**

Add a `proposal` object to the draft with client, scenario, selected equipment, tariff, options, discounts, overrides, computed snapshot, and export metadata. Store IDs and values, not DOM nodes. Recalculate through `CesarCalculator.calculate` after every relevant edit. Keep the existing report fields and local-storage draft compatible.

Generate `public/calculator-catalogs.js` from the JSON catalogs as a read-only browser payload using a build script that serializes the imported JSON without reinterpreting values:

```js
const payload = { calculator, equipment };
fs.writeFileSync(
  'public/calculator-catalogs.js',
  'window.CESAR_CALCULATOR_CATALOGS = Object.freeze(' + JSON.stringify(payload) + ');\n'
);
```

- [ ] **Step 4: Implement priority promotions**

Add `window.CESAR_PRIORITY_PROMOTIONS`, initialize those promotions only for a new draft, retain explicit deselection, sort the picker by priority, and store `priority` on each catalog item so the ordering can later be changed in data.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

Commit:

```bash
git add public/calculator.js public/calculator-catalogs.js public/editor.js public/promotions.js public/index.html tests/calculator-state.test.js
git commit -m "feat: add calculator state and priority promotions"
```

### Task 4: Build the responsive calculator interface

**Files:**
- Modify: `public/index.html`
- Modify: `public/editor.css`
- Modify: `public/calculator.js`
- Modify: `public/editor.js`
- Modify: `public/report-render.js`
- Modify: `public/theme.css`
- Create: `tests/calculator-ui.test.js`

- [ ] **Step 1: Add failing DOM-contract tests**

Verify IDs for scenario selectors, equipment search/results/table, tariff controls, override controls, totals, warnings, and export actions. Verify mobile CSS removes horizontal scrolling and converts equipment rows to cards.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/calculator-ui.test.js`

Expected: FAIL because the calculator controls are absent.

- [ ] **Step 3: Add calculator sections to the existing form**

Add semantic sections in this order: client/object, scenario, equipment, tariff/options, calculation totals, promotions, events, manager, export. Use searchable equipment results, quantity steppers, inline prices, and visible calculated-versus-manual values. Add a `Сбросить к расчёту` action for every override.

- [ ] **Step 4: Add live proposal preview**

Render selected system, equipment totals, installation, monthly fee, material liability, selected options, warnings, and promotions in the existing preview. Hide internal override reasons from the public report.

- [ ] **Step 5: Implement responsive and accessible behavior**

At `max-width: 760px`, stack all controls, render each equipment row as a labelled card, keep totals visible, and expose the existing preview modal. Use actual buttons for actions, labelled inputs, keyboard-operable search results, and `aria-live` for recalculation warnings.

- [ ] **Step 6: Run tests, visual check, and commit**

Run: `npm test`

Start: `node server.js`

Check desktop at 1440×900 and mobile at 390×844. Confirm equipment addition, quantity edits, override/reset, priority promotion toggles, and preview updates.

Commit:

```bash
git add public/index.html public/editor.css public/calculator.js public/editor.js public/report-render.js public/theme.css tests/calculator-ui.test.js
git commit -m "feat: add responsive proposal calculator interface"
```

### Task 5: Generate separate XLSX estimates

**Files:**
- Modify: `package.json`
- Create: `lib/xlsx-export.js`
- Create: `tests/xlsx-export.test.js`
- Modify: `server.js`
- Modify: `public/calculator.js`

- [ ] **Step 1: Install ExcelJS and write failing export tests**

Run: `npm install exceljs`

Test that two equipment systems produce two workbooks, each workbook contains only its own items, required client header fields, formulas `quantity × installed unit price`, and a final total formula.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/xlsx-export.test.js`

Expected: FAIL because `lib/xlsx-export.js` does not exist.

- [ ] **Step 3: Implement workbook generation**

Expose:

```js
async function buildEstimateWorkbook(proposal, group) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(group.label, { pageSetup: { paperSize: 9, orientation: 'landscape' } });
  // branded header, client metadata, item table, formulas, totals, print area
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
function estimateFilename(proposal, group) {
  const owner = String(proposal.client?.name || 'Клиент').replace(/[\\/:*?"<>|]/g, '-');
  const system = String(group.label || group.id).replace(/[\\/:*?"<>|]/g, '-');
  return `Смета ${owner} — ${system}.xlsx`;
}
module.exports = { buildEstimateWorkbook, estimateFilename };
```

Write typed numeric cells, Russian ruble number formats, frozen table header, print scaling, widths, borders, and formulas. Preserve zero-priced rental equipment.

- [ ] **Step 4: Add secure download routes**

Add `POST /api/exports/xlsx` accepting one cleaned proposal snapshot and returning a ZIP when there is more than one system or a single XLSX when there is one. Validate item count, string lengths, finite non-negative numbers, and system IDs server-side.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests pass and generated workbooks reopen through ExcelJS without formula or sheet-name errors.

Commit:

```bash
git add package.json package-lock.json lib/xlsx-export.js server.js public/calculator.js tests/xlsx-export.test.js
git commit -m "feat: export separate equipment estimates"
```

### Task 6: Generate separate branded PDF proposals

**Files:**
- Modify: `package.json`
- Create: `lib/pdf-export.js`
- Create: `assets/fonts/Onest-Regular.ttf`
- Create: `assets/fonts/Onest-SemiBold.ttf`
- Create: `tests/pdf-export.test.js`
- Modify: `server.js`
- Modify: `public/calculator.js`

- [ ] **Step 1: Install PDF dependencies and add failing tests**

Run: `npm install pdfkit archiver`

Test PDF magic bytes, Cyrillic text presence in extracted strings/metadata where supported, one document per equipment system, filenames, non-empty item sections, totals, monthly fee, liability, and promotions.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/pdf-export.test.js`

Expected: FAIL because the PDF builder does not exist.

- [ ] **Step 3: Implement branded PDF builder**

Expose `buildProposalPdf(proposal, group)` and `proposalFilename(proposal, group)`. Register bundled Onest fonts, draw the CESAR header, client/object summary, equipment table, one-time and monthly totals, liability, selected promotions, manager, pagination, and page footer. Never include internal price sources or override reasons.

- [ ] **Step 4: Add PDF route**

Add `POST /api/exports/pdf` with the same validation and grouping rules as XLSX. Return one PDF or a ZIP of separate PDFs. Use `Content-Disposition` with RFC 5987 filename encoding.

- [ ] **Step 5: Render and inspect PDFs**

Create fixtures for one-system and two-system proposals. Render all pages to PNG using Poppler and inspect for clipping, Cyrillic glyphs, broken rows, totals, and page breaks.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Commit:

```bash
git add package.json package-lock.json lib/pdf-export.js assets/fonts server.js public/calculator.js tests/pdf-export.test.js
git commit -m "feat: export separate branded proposals"
```

### Task 7: Persist calculation snapshots and protect public output

**Files:**
- Modify: `server.js`
- Modify: `public/editor.js`
- Modify: `public/report-render.js`
- Create: `tests/proposal-persistence.test.js`

- [ ] **Step 1: Add failing persistence/privacy tests**

Verify reports store the normalized public calculation snapshot, reject malformed or oversized equipment arrays, and omit `source`, `overrideReason`, raw catalogs, and internal pricing metadata from public JSON/rendered HTML.

- [ ] **Step 2: Implement server-side normalization**

Before writing a report, convert proposal data through a strict `publicProposalSnapshot` function. Keep only client-visible fields, selected items, final totals, selected promotions, and export group IDs.

- [ ] **Step 3: Recalculate before generation**

In `editor.js`, require mandatory fields and at least one positive-quantity item, run a final calculation, block on missing tariff rates, and send the reconciled snapshot. Show actionable Russian messages for each missing input.

- [ ] **Step 4: Run tests and commit**

Run: `npm test`

Commit:

```bash
git add server.js public/editor.js public/report-render.js tests/proposal-persistence.test.js
git commit -m "feat: persist safe proposal calculation snapshots"
```

### Task 8: End-to-end verification and deployment

**Files:**
- Modify: `README.md`
- Modify: `ИНСТРУКЦИЯ-ДЛЯ-ПРОГРАММИСТОВ.md`

- [ ] **Step 1: Document catalog refresh and business-rule boundaries**

Document the exact import command, source precedence, unresolved rules, override audit fields, export endpoints, and deployment dependencies.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm ci
npm test
node --check server.js
node --check public/calculator-engine.js
node --check public/calculator.js
node --check public/editor.js
git diff --check
```

Expected: zero failures.

- [ ] **Step 3: Verify real workflows**

Test these scenarios in desktop and mobile browsers:

1. B2C apartment, basic tariff, extra household sensor triggers value tariff.
2. B2C apartment with three cameras triggers video tariff plus two camera options.
3. B2B rental applies 15% and permits manual monthly fee, installation, and liability overrides including zero.
4. Mixed Si-Nord and Hikvision items produce two PDFs and two XLSX estimates.
5. Three priority promotions start enabled and can each be disabled.
6. Public report shows final client values and no internal metadata.

- [ ] **Step 4: Inspect exported artifacts**

Open every XLSX in a compatible engine and verify formulas/totals. Render every PDF page to images and inspect Cyrillic, tables, page breaks, logos, totals, and promotion cards.

- [ ] **Step 5: Deploy and verify production**

Push `main`, wait for Render, then verify editor load, catalog load, report generation, public report, PDF export, and XLSX export through `https://cesar-satellite-report.netlify.app`.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md ИНСТРУКЦИЯ-ДЛЯ-ПРОГРАММИСТОВ.md
git commit -m "docs: explain calculator catalogs and exports"
```
