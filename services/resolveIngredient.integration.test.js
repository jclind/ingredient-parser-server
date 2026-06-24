// Integration: REAL resolveIngredient + spoonacular + ingredientStore (no mocks)
// against an in-memory fake db and a fake fetch. This exercises the actual
// fetched-doc → stored-doc → findIngredient round-trip that the fully-mocked
// unit tests can't.

const { resolveIngredient } = require('./resolveIngredient')
const { mapToNeutral } = require('./mapToNeutral')

// Minimal in-memory Mongo stand-in for the two collections ingredientStore uses.
function fakeDb() {
  const store = { ingredients: [], ingredient_names: [] }
  const matches = (doc, q) => Object.keys(q).every(k => doc[k] === q[k])
  const coll = arr => ({
    async findOne(q) {
      return arr.find(d => matches(d, q)) ?? null
    },
    async updateOne(q, upd, options = {}) {
      let d = arr.find(x => matches(x, q))
      if (!d) {
        if (!options.upsert) return
        d = { ...q }
        arr.push(d)
      }
      if (upd.$set) Object.assign(d, upd.$set)
    },
    async insertOne(doc) {
      if (arr.some(x => x.name === doc.name)) {
        const e = new Error('duplicate key')
        e.code = 11000
        throw e
      }
      arr.push({ ...doc })
    },
  })
  return { collection: name => coll(store[name]), _store: store }
}

const ok = body => ({ ok: true, status: 200, json: async () => body })

function fakeFetch(routes) {
  const calls = []
  const impl = async url => {
    calls.push(url)
    for (const [match, response] of routes) if (url.includes(match)) return response
    throw new Error(`unexpected url: ${url}`)
  }
  impl.calls = calls
  return impl
}

const flourRoutes = [
  ['search?query=flour', ok({ results: [{ id: 20081 }] })],
  ['unit=grams', ok({ id: 20081, name: 'wheat flour', aisle: 'Baking', image: 'flour.png', possibleUnits: ['g', 'cup'], nutrition: { nutrients: [{ name: 'Protein', amount: 0.1, unit: 'g' }] }, estimatedCost: { value: 0.13 } })],
  ['20081/information?amount=1', ok({ id: 20081, estimatedCost: { value: 50 } })],
]

describe('resolveIngredient — integration', () => {
  test('miss → fetch → store → neutral, then query AND canonical name are cache hits', async () => {
    const db = fakeDb()
    const fetchImpl = fakeFetch(flourRoutes)
    const negativeCache = new Map()
    const o = { apiKey: 'k', fetchImpl, negativeCache }

    const r1 = await resolveIngredient(db, 'flour', o)
    expect(r1.name).toBe('wheat flour')
    expect(r1.estimatedPrices).toEqual({ estimatedGramPrice: 0.13, estimatedSingleUnitPrice: 50 })
    const afterFirst = fetchImpl.calls.length
    expect(afterFirst).toBe(3) // search + 2 info

    // round-trips cleanly through mapToNeutral
    expect(mapToNeutral(r1)).toMatchObject({
      name: 'wheat flour',
      category: 'Baking',
      imageFilename: 'flour.png',
      estimatedPrices: { perGramCents: 0.13, perUnitCents: 50 },
    })

    // same query → cache hit, no new fetch
    await resolveIngredient(db, 'flour', o)
    expect(fetchImpl.calls.length).toBe(afterFirst)

    // canonical term → also a cache hit (it was registered)
    const r3 = await resolveIngredient(db, 'wheat flour', o)
    expect(fetchImpl.calls.length).toBe(afterFirst)
    expect(r3.name).toBe('wheat flour')
  })

  test('a real miss is negative-cached (no second Spoonacular search)', async () => {
    const db = fakeDb()
    const fetchImpl = fakeFetch([['search', ok({ results: [] })]])
    const o = { apiKey: 'k', fetchImpl, negativeCache: new Map() }
    expect(await resolveIngredient(db, 'unobtainium', o)).toBeNull()
    expect(await resolveIngredient(db, 'unobtainium', o)).toBeNull()
    expect(fetchImpl.calls.length).toBe(1) // second short-circuited by negative cache
  })

  test('an upstream rate-limit degrades to null without throwing', async () => {
    const db = fakeDb()
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) })
    const r = await resolveIngredient(db, 'flour', { apiKey: 'k', fetchImpl, negativeCache: new Map() })
    expect(r).toBeNull()
  })
})
