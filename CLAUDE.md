# CLAUDE.md

Guidance for Claude Code when working in this repo. See `README.md` for the public API reference.

## What this is

The Prepify ingredient service: a lightweight Express + MongoDB **cache** for ingredient data, deployed on Railway. It is consumed by two clients:
- `@jclind/ingredient-parser` (v1) — `../ingredient-parser`
- `@jclind/ingredient-parser-v2` — `../ingredient-parser-v2`

**One server serves both.** We version the *response shape*, not the storage. The neutral v2 shape is a pure read-time projection of the same stored documents, so there is no second deployment, no duplicated cache, and v1 keeps working byte-for-byte.

## Commands

```bash
npm test          # jest + supertest — 77 tests across 8 suites
npm run dev       # nodemon on PORT (default 4001); needs MONGO_URI
npm start         # production start
```

`.env`: `MONGO_URI` (required), `PORT` (optional), `SPOONACULAR_API_KEY` (optional — enables Phase 2 server-side miss-fill on the v2 route). DB name is `prepify`.

## Architecture

The v1 route is a **pure cache** — on a miss the *client* fetches Spoonacular and writes back via `POST /ingredient`. The v2 route is **cache-or-fetch**: on a miss, if `SPOONACULAR_API_KEY` is set the server fetches Spoonacular itself, caches it, and returns it; if the key is unset it behaves like the pure cache (`data: null`). So the key lives server-side only — no client ever needs it.

```
GET  /ingredient/:name      → v1: raw stored shape        ({ data } or { data: null })
GET  /v2/ingredient/:name   → v2: neutral projection      ({ data } or { data: null })
POST /ingredient            → write-back (upsert + name registry)
GET  /health
```

- `services/ingredientStore.js` — all DB logic. `findIngredient` does a two-step lookup: `ingredient_names` registry (name → id) → `ingredients` (by Spoonacular `id`). `writeIngredient` upserts then registers the name, handling conflicts + duplicate-key races.
- `services/normalizeName.js` — lowercase, trim, hyphens→spaces. Applied on both read and write, so `All-Purpose Flour` / `all purpose flour` collapse to one key. (Guards non-string input → `''`.)
- `services/mapToNeutral.js` — **the v2 projection.** Raw stored doc → `{ name, category, imageFilename, possibleUnits, nutrition, estimatedPrices:{perGramCents,perUnitCents} }`. Pure, defensive, crash-safe on any input. Returns the bare image *filename* (the client sizes it).
- `services/spoonacular.js` — **Phase 2 fetch.** `fetchIngredient(name, {apiKey, fetchImpl})`: search → two `/information` calls (unit=grams + plain) → stored-doc with `estimatedPrices`. Native `fetch` (injectable), 8s timeout, key sent as `x-api-key` header. Throws clear errors on timeout/401/402/429/5xx/network/malformed-body.
- `services/resolveIngredient.js` — **cache-or-fetch orchestration.** find → on miss + key, `fetchIngredient` + best-effort write-back (query + canonical name) → return; on miss + no key, null. Upstream failures degrade to null; a per-process negative cache + a 200-char name cap protect the paid upstream. Used by the v2 route.
- `routes/ingredient.js` (v1) and `routes/ingredientV2.js` (v2). Thin HTTP layers. Both mounted in `index.js`.

### Data model (MongoDB, `prepify` db)
- `ingredients` — one doc per Spoonacular id: `{ id, ingredientData }`. Unique index on `id`.
- `ingredient_names` — `{ name, ingredientId }`. Many names → one id. Unique index on `name`.

### Stored doc shape — important
The `README.md` Data Model example shows raw Spoonacular fields (`estimatedCost: {value, unit}`) and is **incomplete**: the v1 client actually writes an enriched doc that ALSO contains `estimatedPrices: { estimatedGramPrice, estimatedSingleUnitPrice }` (derived from two Spoonacular calls). Real cached docs have **both**. `mapToNeutral` prefers `estimatedPrices` and falls back to `estimatedCost.value` for the per-gram price (for the grams-fetched doc those are equal — verified on live data), so it works for both shapes.

## Conventions / gotchas

- **Miss = HTTP 200 with `{ data: null }`**, never 404. The v2 client relies on this. A 500 means a real server/DB error — Spoonacular upstream failures are deliberately degraded to a `data: null` miss, not a 500 (see Phase 2).
- `nutrition` is only passed through if it's a non-array object with a `nutrients` array, else `null` — so the neutral `nutrition` field is honestly usable-or-null. v2 ships nutrition over the wire regardless of client preference (the client filters); a `?nutrition=false` param is a future optimization.
- v1 files (`routes/ingredient.js`, `services/ingredientStore.js`) are unchanged by the v2 work — only `index.js` gained 2 lines to mount `/v2/ingredient`. Don't entangle them.
- No NoSQL-injection exposure: `:name` is always a string used as a query *value*, never spread as an operator object.

## Phase 2 (BUILT)

Server-side Spoonacular fetch is implemented and gated on `SPOONACULAR_API_KEY`:
- **Key set:** v2 misses fetch from Spoonacular, cache, and return — misses self-populate.
- **Key unset:** identical to Phase 1 (pure cache). So deploying the code is a no-op until the key is added in Railway.

To activate: set `SPOONACULAR_API_KEY` in the Railway service env and redeploy.

Hardening (it's a paid, unauthenticated upstream):
- **Timeout:** every Spoonacular call has an 8s `AbortController` timeout (native `fetch` has none).
- **Key as header:** sent via `x-api-key`, never in the URL — so it can't leak into logs or error messages.
- **Graceful degrade:** an upstream failure (timeout / 401 / 402 / 429 / 5xx / network / malformed body) is logged server-side and returns a clean `data: null` (a miss), NOT a 500 — so a Spoonacular hiccup doesn't break every request or the client's fallback chain. Only DB errors 500.
- **Negative cache:** misses/failures are remembered for 10 min (per-process) so they don't re-bill Spoonacular on every retry.
- **Length cap:** names > 200 chars are rejected before any fetch.
- **Canonical registration:** both the query name and Spoonacular's canonical name are registered, so a later lookup by the canonical term is a cache hit, not a re-fetch.

**Still recommended at the edge (not in this code):** request rate limiting on the `/v2` route and a Spoonacular daily-quota cap — the negative cache only helps *repeated* names; a flood of *distinct* names still costs ~1 search call each. The `/v2` route is unauthenticated.

## Key files
- `index.js` — Express setup, Mongo connect, index creation, route mounting
- `services/mapToNeutral.js` — v2 neutral projection (+ `.test.js`)
- `services/spoonacular.js` — Phase 2 Spoonacular fetch (+ `.test.js`)
- `services/resolveIngredient.js` — cache-or-fetch orchestration (+ `.test.js`)
- `services/ingredientStore.js` — DB read/write (+ `.test.js`)
- `routes/ingredientV2.js` — `GET /v2/ingredient/:name` (+ `.test.js`)
- `routes/ingredient.js` — v1 routes (+ `.test.js`)
