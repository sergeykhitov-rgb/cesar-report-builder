# Authentic Equipment Artwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three promotion visuals with compositions that preserve official CESAR SATELLITE product and sticker artwork exactly.

**Architecture:** Store official high-resolution source assets locally with source URLs and SHA-256 provenance. Per the latest user direction, generate `switch-free` and `rental-zero` fully in Nano Banana from stable, separate composition bases plus the official CESAR image references. Keep deterministic Pillow compositing only for the already-approved `two-objects` sticker image.

**Tech Stack:** Node test runner, Python 3 + Pillow, Higgsfield Nano Banana 2 Lite, existing static promotion catalog.

---

### Task 1: Add official source assets and provenance tests

**Files:**
- Create: `public/assets/promotions/references/official-sources.json`
- Modify: `tests/promotions.test.js`
- Replace: `public/assets/promotions/references/security-kit.png`
- Create: `public/assets/promotions/references/security-sticker.webp`
- Replace: `public/assets/promotions/references/motion-sensor.webp`
- Replace: `public/assets/promotions/references/keypad.webp`

- [ ] **Step 1: Write the failing provenance test**

Add a test that loads `official-sources.json`, requires entries named `security-kit`, `security-sticker`, `motion-sensor`, and `keypad`, checks that every URL starts with `https://www.csat.ru/storage/media/`, and compares each local file SHA-256 with the declared hash.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: FAIL because `official-sources.json` and the sticker asset do not exist.

- [ ] **Step 3: Download official originals**

Use these official URLs:

```text
https://www.csat.ru/storage/media/8a/c28668809d7a5007ab40751c89895370.png?v=1727431706
https://www.csat.ru/storage/media/resized/30/cc17ff8c0b5bce73411d3bc17b1e5318-x2-webp.webp?v=1725347784
https://www.csat.ru/storage/media/resized/1d/71a1a75e7262b69083b8bc90cc53e053-x2-webp.webp?v=1725347774
https://www.csat.ru/storage/media/resized/bd/5f1590a883ed004b224ac5443cef8489-x2-webp.webp?v=1725347773
```

Calculate each file SHA-256 and record it beside the URL and local path in `official-sources.json`.

- [ ] **Step 4: Run the provenance test**

Run: `npm test`

Expected: all tests pass and every official file hash matches.

- [ ] **Step 5: Commit official sources**

```bash
git add public/assets/promotions/references tests/promotions.test.js
git commit -m "assets: add verified CESAR equipment sources"
```

### Task 2: Build the three corrected promotion images

**Files:**
- Create: `scripts/compose-authentic-promotions.py`
- Modify: `scripts/regenerate-promotion-equipment.mjs`
- Replace: `public/assets/promotions/source/switch-free.png`
- Replace: `public/assets/promotions/source/rental-zero.png`
- Replace: `public/assets/promotions/source/two-objects.png`
- Replace: `public/assets/promotions/switch-free.webp`
- Replace: `public/assets/promotions/rental-zero.webp`
- Replace: `public/assets/promotions/two-objects.webp`

- [ ] **Step 1: Add failing output checks**

Extend `tests/promotions.test.js` to require all three output WebP files to be 1280x720 and require `scripts/compose-authentic-promotions.py` to reference the official kit, sticker, motion sensor, and keypad source paths.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: FAIL because the compositor does not exist.

- [ ] **Step 3: Generate switch-free from a stable ladder base**

Run Nano Banana 2 Lite with `switch-free-generation-base.png` as the immutable composition reference plus the official motion-sensor and keypad references. The sensor must be physically small and mounted directly beneath the raised fingers; the keypad must be wall-mounted nearby at realistic chest/hand height. Both must have believable scale, perspective, and contact with the wall.

- [ ] **Step 4: Generate rental-zero and retain deterministic sticker compositing**

Run Nano Banana 2 Lite with `rental-zero-generation-base.png` plus the official complete kit reference to create a premium minimalist architectural/studio hero scene: full kit prominent and grounded, no houses and no text. `compose-authentic-promotions.py` remains restricted to `compose_two_objects()`, preserving the approved properties and official security sticker. The earlier manual coordinates for switch-free and rental-zero are retired because those two visuals now use the user-requested reference-driven generation workflow.

- [ ] **Step 5: Optimize outputs**

Run:

```bash
python3 scripts/compose-authentic-promotions.py
python3 scripts/optimize-promotions.py
```

Expected: all three PNG sources and WebP outputs are 1280x720.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit corrected artwork**

```bash
git add scripts public/assets/promotions tests/promotions.test.js
git commit -m "fix: use authentic equipment in promotion artwork"
```

### Task 3: Visual verification and production deployment

**Files:**
- Verify: `public/assets/promotions/*.webp`
- Verify: `public/index.html`
- Verify: `public/report.html`

- [ ] **Step 1: Render and inspect the contact sheet**

Run: `python3 scripts/optimize-promotions.py`

Inspect `/tmp/promotions-contact-sheet.jpg`. Confirm the switch scene has a high corner sensor and chest-height keypad, the rental card contains only the complete real kit, and the two-property card contains the real security sticker.

- [ ] **Step 2: Verify the local editor and public report**

Open the editor at desktop and mobile widths, select all three corrected promotions, generate a report, and confirm the same visuals appear in the public report.

- [ ] **Step 3: Run final verification**

```bash
npm test
node --check public/promotions.js
node --check public/editor.js
node --check public/report-render.js
python3 -m py_compile scripts/compose-authentic-promotions.py
git diff --check
```

Expected: zero failures and zero syntax errors.

- [ ] **Step 4: Push and deploy**

Push `main`; allow Render to rebuild; deploy `netlify-proxy` to production with Netlify CLI.

- [ ] **Step 5: Verify production**

Open `https://cesar-satellite-report.netlify.app`, confirm 14 promotion cards load, and verify the three corrected images on the production URL.
