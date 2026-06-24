// Spoonacular fetch — server-side (Phase 2).
//
// On a cache miss the server fetches from Spoonacular itself, so the API key
// lives here (server-side), never in any client. Mirrors v1's client logic:
// search → two `/information` calls (one with unit=grams for the per-gram price,
// one without for the per-single-unit price) → assemble a stored doc that
// carries `estimatedPrices` alongside the raw fields.
//
// `fetchImpl` is injectable so the whole module is unit-testable without network.

const BASE_URL = 'https://api.spoonacular.com/food/ingredients/'
const DEFAULT_TIMEOUT_MS = 8000

function httpError(status) {
  if (status === 401) return new Error('Spoonacular API key not valid')
  if (status === 402) return new Error('Spoonacular daily quota exceeded')
  if (status === 429) return new Error('Spoonacular rate limit exceeded')
  return new Error(`Spoonacular request failed (${status})`)
}

// GET + parse JSON with a hard timeout (native fetch has none). The key is sent
// as a header, never in the URL, so it can't leak into logs, error messages, or
// Spoonacular's own access logs.
async function getJson(url, fetchImpl, { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetchImpl(url, { headers: { 'x-api-key': apiKey }, signal: controller.signal })
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Spoonacular request timed out')
    throw new Error(`Spoonacular network error: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw httpError(res.status)
  try {
    return await res.json()
  } catch {
    throw new Error('Spoonacular returned a malformed response')
  }
}

/**
 * Look an ingredient up on Spoonacular.
 * @returns the stored-doc shape (raw info + estimatedPrices), or null if no match.
 * @throws on a missing key or an HTTP/network/timeout error.
 */
async function fetchIngredient(
  name,
  { apiKey, fetchImpl = globalThis.fetch, baseUrl = BASE_URL, timeoutMs } = {}
) {
  if (!apiKey) throw new Error('Spoonacular API key not configured')
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available')

  const opts = { apiKey, timeoutMs }
  const enc = encodeURIComponent(name)
  const search = await getJson(`${baseUrl}search?query=${enc}&number=1`, fetchImpl, opts)
  const id = search && search.results && search.results[0] && search.results[0].id
  if (id == null) return null

  const [gram, single] = await Promise.all([
    getJson(`${baseUrl}${id}/information?amount=1&unit=grams&includeNutrition=true`, fetchImpl, opts),
    getJson(`${baseUrl}${id}/information?amount=1`, fetchImpl, opts),
  ])

  const estimatedGramPrice = (gram && gram.estimatedCost && gram.estimatedCost.value) ?? 0
  const estimatedSingleUnitPrice =
    (single && single.estimatedCost && single.estimatedCost.value) ?? 0

  // Keep Spoonacular's canonical fields (incl. its `name`); just attach prices.
  return {
    ...gram,
    id: (gram && gram.id) ?? id,
    estimatedPrices: { estimatedGramPrice, estimatedSingleUnitPrice },
  }
}

module.exports = { fetchIngredient, BASE_URL }
