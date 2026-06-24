// Cache-or-fetch orchestration (Phase 2).
//
// find in Mongo → on miss, if a Spoonacular key is configured, fetch + cache +
// return; otherwise return null (the Phase 1 behavior). Hardened for a paid,
// unauthenticated upstream:
//   - upstream failures degrade to a clean miss (null), never a 500, so a
//     Spoonacular hiccup doesn't break every request or the client's fallback
//   - a short-TTL negative cache stops repeated misses/failures from re-billing
//   - over-long names are rejected before they ever hit Spoonacular
//   - both the query name AND Spoonacular's canonical name are registered, so a
//     later lookup by the canonical term is a cache hit (not a re-fetch)
//
// NOTE: the negative cache is per-process (resets on restart, not shared across
// instances) and is NOT a substitute for request rate limiting / a Spoonacular
// daily-quota cap — add those at the edge for a public endpoint.

const { findIngredient, writeIngredient } = require('./ingredientStore')
const { fetchIngredient } = require('./spoonacular')

const MAX_NAME_LENGTH = 200
const NEGATIVE_TTL_MS = 10 * 60 * 1000

// module-level default; injectable for tests
const defaultNegativeCache = new Map()

async function safeWrite(db, name, doc) {
  try {
    await writeIngredient(db, name, doc)
  } catch (err) {
    // best-effort: a write failure (incl. a name->different-id conflict) must
    // not fail the read. Surface it for ops without breaking the request.
    console.warn(`[v2] cache write-back failed for "${name}": ${err.message}`)
  }
}

async function resolveIngredient(
  db,
  name,
  { apiKey, fetchImpl, timeoutMs, negativeCache = defaultNegativeCache, now = Date.now } = {}
) {
  const cached = await findIngredient(db, name)
  if (cached) return cached

  // No key → behave exactly like the pure cache (graceful miss).
  if (!apiKey) return null
  if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) return null

  const key = name.toLowerCase().trim()
  const t = now()
  const expiry = negativeCache.get(key)
  if (expiry !== undefined) {
    if (expiry > t) return null // recently missed/failed — don't re-bill Spoonacular
    negativeCache.delete(key)
  }

  let fetched
  try {
    fetched = await fetchIngredient(name, { apiKey, fetchImpl, timeoutMs })
  } catch (err) {
    // Transient/config upstream failure → degrade to a miss (not a 500).
    console.warn(`[v2] Spoonacular fetch failed for "${name}": ${err.message}`)
    negativeCache.set(key, t + NEGATIVE_TTL_MS)
    return null
  }

  // No match, or a malformed doc we shouldn't cache or serve.
  if (!fetched || fetched.id == null || !fetched.name) {
    negativeCache.set(key, t + NEGATIVE_TTL_MS)
    return null
  }

  // Best-effort write-back. Register the query name and (if different) the
  // canonical name, so both resolve to a cache hit next time.
  await safeWrite(db, name, fetched)
  if (typeof fetched.name === 'string' && fetched.name.toLowerCase().trim() !== key) {
    await safeWrite(db, fetched.name, fetched)
  }

  return fetched
}

module.exports = { resolveIngredient }
