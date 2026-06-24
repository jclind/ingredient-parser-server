const { fetchIngredient, BASE_URL } = require('./spoonacular')

const ok = body => ({ ok: true, status: 200, json: async () => body })
const err = status => ({ ok: false, status, json: async () => ({}) })

// A fake fetch that routes by URL substring and records (url, opts).
function fakeFetch(routes) {
  const calls = []
  const impl = async (url, opts) => {
    calls.push({ url, opts })
    for (const [match, response] of routes) {
      if (url.includes(match)) return typeof response === 'function' ? response(url) : response
    }
    throw new Error(`unexpected url: ${url}`)
  }
  impl.calls = calls
  impl.urls = () => calls.map(c => c.url)
  return impl
}

describe('fetchIngredient', () => {
  test('search → two info calls → stored doc with estimatedPrices', async () => {
    const fetchImpl = fakeFetch([
      ['search?query=flour', ok({ results: [{ id: 20081, name: 'wheat flour' }] })],
      ['20081/information?amount=1&unit=grams', ok({ id: 20081, name: 'wheat flour', aisle: 'Baking', estimatedCost: { value: 0.13 }, nutrition: { nutrients: [] } })],
      ['20081/information?amount=1', ok({ id: 20081, estimatedCost: { value: 49.5 } })],
    ])
    const doc = await fetchIngredient('flour', { apiKey: 'k', fetchImpl })
    expect(doc).toMatchObject({
      id: 20081,
      name: 'wheat flour',
      aisle: 'Baking',
      estimatedPrices: { estimatedGramPrice: 0.13, estimatedSingleUnitPrice: 49.5 },
    })
    expect(doc.nutrition).toEqual({ nutrients: [] })
  })

  test('sends the key as an x-api-key header, never in the URL', async () => {
    const fetchImpl = fakeFetch([
      ['search', ok({ results: [{ id: 7 }] })],
      ['unit=grams', ok({ id: 7, estimatedCost: { value: 1 } })],
      ['7/information?amount=1', ok({ id: 7, estimatedCost: { value: 2 } })],
    ])
    await fetchIngredient('x', { apiKey: 'secret-key', fetchImpl })
    for (const { url, opts } of fetchImpl.calls) {
      expect(url).not.toContain('secret-key')
      expect(url).not.toContain('apiKey')
      expect(opts.headers['x-api-key']).toBe('secret-key')
      expect(opts.signal).toBeDefined() // timeout wired
    }
  })

  test('search uses number=1; gram call has unit=grams+includeNutrition; single call has neither', async () => {
    const fetchImpl = fakeFetch([
      ['search', ok({ results: [{ id: 7 }] })],
      ['unit=grams', ok({ id: 7, estimatedCost: { value: 1 } })],
      ['7/information?amount=1', ok({ id: 7, estimatedCost: { value: 2 } })],
    ])
    await fetchIngredient('x', { apiKey: 'k', fetchImpl })
    const urls = fetchImpl.urls()
    expect(urls[0]).toContain('number=1')
    expect(urls.some(u => u.includes('unit=grams') && u.includes('includeNutrition=true'))).toBe(true)
    const single = urls.find(u => /\/information\?amount=1$/.test(u))
    expect(single).toBeDefined() // single-unit call omits unit=grams
  })

  test('no search results → null, no info calls', async () => {
    const fetchImpl = fakeFetch([['search', ok({ results: [] })]])
    expect(await fetchIngredient('zzz', { apiKey: 'k', fetchImpl })).toBeNull()
    expect(fetchImpl.calls.length).toBe(1)
  })

  test('search response missing the results array → null', async () => {
    const fetchImpl = fakeFetch([['search', ok({})]])
    expect(await fetchIngredient('zzz', { apiKey: 'k', fetchImpl })).toBeNull()
  })

  test('encodes the query name', async () => {
    const fetchImpl = fakeFetch([['search', ok({ results: [] })]])
    await fetchIngredient('all-purpose flour', { apiKey: 'k', fetchImpl })
    expect(fetchImpl.calls[0].url).toContain('query=all-purpose%20flour')
  })

  test.each([
    [401, /key not valid/i],
    [402, /quota exceeded/i],
    [429, /rate limit/i],
    [503, /failed \(503\)/i],
  ])('throws a clear error on HTTP %s', async (status, re) => {
    const fetchImpl = fakeFetch([['search', err(status)]])
    await expect(fetchIngredient('x', { apiKey: 'k', fetchImpl })).rejects.toThrow(re)
  })

  test('wraps network errors', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
    await expect(fetchIngredient('x', { apiKey: 'k', fetchImpl })).rejects.toThrow(/network error/i)
  })

  test('maps an aborted request to a timeout error', async () => {
    const fetchImpl = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    await expect(fetchIngredient('x', { apiKey: 'k', fetchImpl })).rejects.toThrow(/timed out/i)
  })

  test('throws on a malformed (non-JSON) 200 body', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token') } })
    await expect(fetchIngredient('x', { apiKey: 'k', fetchImpl })).rejects.toThrow(/malformed/i)
  })

  test('throws when no api key', async () => {
    await expect(fetchIngredient('x', { fetchImpl: async () => ok({}) })).rejects.toThrow(/not configured/i)
  })

  test('exposes the production base url', () => {
    expect(BASE_URL).toBe('https://api.spoonacular.com/food/ingredients/')
  })
})
