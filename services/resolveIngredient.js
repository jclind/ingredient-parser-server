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
const { normalizeName } = require('./normalizeName')

const MAX_NAME_LENGTH = 200
// A genuine "Spoonacular searched and found nothing" is a stable fact — cache it
// long so we don't re-bill the paid upstream for the same dead name.
const NO_MATCH_TTL_MS = 10 * 60 * 1000
// A transient/config upstream failure (timeout / network / 429 / 5xx / bad key /
// quota) is recoverable — cache it only briefly so a momentary Spoonacular blip
// doesn't blackhole a genuinely fetchable ingredient for the full no-match
// window, while still throttling a hot retry loop.
const TRANSIENT_TTL_MS = 60 * 1000

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

  // Key the negative cache with the SAME normalization the store uses, so
  // hyphen/whitespace variants of one name ("all-purpose flour" /
  // "all purpose flour") share a single entry instead of each re-billing.
  const key = normalizeName(name)
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
    // Transient/config upstream failure → degrade to a miss (not a 500) and
    // remember it only briefly (recoverable).
    console.warn(`[v2] Spoonacular fetch failed for "${name}": ${err.message}`)
    negativeCache.set(key, t + TRANSIENT_TTL_MS)
    return null
  }

  // No match, or a malformed doc we shouldn't cache or serve. A clean "no match"
  // is a stable absence → cache it long.
  if (!fetched || fetched.id == null || !fetched.name) {
    negativeCache.set(key, t + NO_MATCH_TTL_MS)
    return null
  }

  // Best-effort write-back. Register the query name and (if different) the
  // canonical name, so both resolve to a cache hit next time.
  await safeWrite(db, name, fetched)
  if (typeof fetched.name === 'string' && normalizeName(fetched.name) !== key) {
    await safeWrite(db, fetched.name, fetched)
  }

  return fetched
}

module.exports = { resolveIngredient }
