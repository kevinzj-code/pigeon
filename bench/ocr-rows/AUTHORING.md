# Writing clean texts for the OCR clean-up's training rows

Patch reads text from photos with the Mac's OCR engine. A small model then
repairs only what OCR breaks: lines broken in the middle of a sentence, a space
before a comma, words run together or split, and an obviously misread letter
inside a word. It must never change a number. See the system prompt
`CLEANUP_SYSTEM` in `src/ocr.js`.

You write the **clean originals**: the text exactly as it was printed. A script
(`scripts/ocr-corrupt.mjs`) damages each one the way OCR does, and the model
learns to give back your text exactly. So every character you write is the
answer it is trained on.

## Rules

1. **Kinds,** 15 of each per batch: `receipt`, `notice` (notice or sign),
   `letter` (letter or email excerpt), `menu`, `timetable`, `recipe` (recipe
   card), `label` (label or packaging), `flyer`, `form` (form or ticket), `page`
   (page of a book or leaflet).
2. **2 to 12 lines, 15 to 120 words.** Keep real line structure: lists,
   receipts, menus and timetables have one item per line. **Prose paragraphs are
   ONE long line each.** Never hard-wrap a sentence; the script adds that damage.
3. **Numbers, plenty of them,** as photographed things have: prices and totals
   that add up, times, dates, quantities, codes, reference numbers, phone
   numbers in fictional ranges (01632 960xxx, 07700 900xxx, 555-01xx).
4. **Clean and correct:** no typos, no doubled spaces, normal punctuation
   spacing, consistent capitals as printed (shop names in capitals are fine).
5. **Vary everything:** places, names, currencies (£, $, €), date formats, 12-
   and 24-hour times, British and American spelling, abbreviations people print
   ("Qty", "No.", "approx."). Include characters OCR finds hard: °, é, ñ, @, #, %,
   fractions like 1 1/2.
6. **All invented:** shops, people, addresses. Stay clear of the held-out texts
   (the checker refuses anything close) and of your batch's other texts.

## Output

Write `bench/ocr-rows/authored/<batch>.json`:

```json
{ "batch": "o01", "texts": [ { "kind": "receipt", "text": "line one\nline two" } ] }
```

Then run, and fix until it passes with 0 errors:

```
node scripts/ocrdata-check.mjs bench/ocr-rows/authored/<batch>.json
```

Reply with the count per kind and anything you were unsure about.

## Batches

o01 to o10, 150 texts each. Give each batch its own flavour so they don't
repeat each other:

| Batch | Setting |
|---|---|
| o01 | a small English market town |
| o02 | a large US city |
| o03 | a seaside resort |
| o04 | a university campus |
| o05 | rural Scotland and Wales |
| o06 | an Irish county town |
| o07 | an Australian suburb |
| o08 | a Canadian city |
| o09 | a European city with prices in euros |
| o10 | hospitals, offices and transport hubs anywhere |
