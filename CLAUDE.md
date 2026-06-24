# CLAUDE.md

Guidance for Claude Code when working in this repo. See `README.md` for the public API reference.

## What this is

The Prepify ingredient service: a lightweight Express + MongoDB **cache** for ingredient data, deployed on Railway. It is consumed by two clients:
- `@jclind/ingredient-parser` (v1) — `../ingredient-parser`
- `@jclind/ingredient-parser-v2` — `../ingredient-parser-v2`

**One server serves both.** We version the *response shape*, not the storage. The neutral v2 shape is a pure read-time projection of the same stored documents, so there is no second deployment, no duplicated cache, and v1 keeps working byte-for-byte.

## Commands

```bash
npm test          # jest + supertest — 48 tests across 5 suites
npm run dev       # nodemon on PORT (default 4001); needs MONGO_URI
npm start         # production start
```

`.env`: `MONGO_URI` (required), `PORT` (optional). DB name is `prepify`.

## Architecture

Pure cache — **the server does not call Spoonacular** (today). On a miss the *client* fetches Spoonacular and writes back via `POST /ingredient`.

```
GET  /ingredient/:name      → v1: raw stored shape        ({ data } or { data: null })
GET  /v2/ingredient/:name   → v2: neutral projection      ({ data } or { data: null })
POST /ingredient            → write-back (upsert + name registry)
GET  /health
```

- `services/ingredientStore.js` — all DB logic. `findIngredient` does a two-step lookup: `ingredient_names` registry (name → id) → `ingredients` (by Spoonacular `id`). `writeIngredient` upserts then registers the name, handling conflicts + duplicate-key races.
- `services/normalizeName.js` — lowercase, trim, hyphens→spaces. Applied on both read and write, so `All-Purpose Flour` / `all purpose flour` collapse to one key. (Guards non-string input → `''`.)
- `services/mapToNeutral.js` — **the v2 projection.** Raw stored doc → `{ name, category, imageFilename, possibleUnits, nutrition, estimatedPrices:{perGramCents,perUnitCents} }`. Pure, defensive, crash-safe on any input. Returns the bare image *filename* (the client sizes it).
- `routes/ingredient.js` (v1) and `routes/ingredientV2.js` (v2). Thin HTTP layers over the store. Both mounted in `index.js`.

### Data model (MongoDB, `prepify` db)
- `ingredients` — one doc per Spoonacular id: `{ id, ingredientData }`. Unique index on `id`.
- `ingredient_names` — `{ name, ingredientId }`. Many names → one id. Unique index on `name`.

### Stored doc shape — important
The `README.md` Data Model example shows raw Spoonacular fields (`estimatedCost: {value, unit}`) and is **incomplete**: the v1 client actually writes an enriched doc that ALSO contains `estimatedPrices: { estimatedGramPrice, estimatedSingleUnitPrice }` (derived from two Spoonacular calls). Real cached docs have **both**. `mapToNeutral` prefers `estimatedPrices` and falls back to `estimatedCost.value` for the per-gram price (for the grams-fetched doc those are equal — verified on live data), so it works for both shapes.

## Conventions / gotchas

- **Miss = HTTP 200 with `{ data: null }`**, never 404. Errors = 500. Keep this contract; the v2 client relies on it.
- `nutrition` is only passed through if it's a non-array object with a `nutrients` array, else `null` — so the neutral `nutrition` field is honestly usable-or-null. v2 ships nutrition over the wire regardless of client preference (the client filters); a `?nutrition=false` param is a future optimization.
- v1 files (`routes/ingredient.js`, `services/ingredientStore.js`) are unchanged by the v2 work — only `index.js` gained 2 lines to mount `/v2/ingredient`. Don't entangle them.
- No NoSQL-injection exposure: `:name` is always a string used as a query *value*, never spread as an operator object.

## Phase 2 (pending, not built)

Move the Spoonacular call **server-side**: server holds `SPOONACULAR_API_KEY`, fills cache misses itself (v1's two-call gram+unit price derivation), and returns the neutral shape. Then the v2 client needs no key and misses self-populate. This is the point of "proxy-only."

## Key files
- `index.js` — Express setup, Mongo connect, index creation, route mounting
- `services/mapToNeutral.js` — v2 neutral projection (+ `.test.js`)
- `services/ingredientStore.js` — DB read/write (+ `.test.js`)
- `routes/ingredientV2.js` — `GET /v2/ingredient/:name` (+ `.test.js`)
- `routes/ingredient.js` — v1 routes (+ `.test.js`)
