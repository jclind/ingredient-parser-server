jest.mock('./ingredientStore')
jest.mock('./spoonacular')

const { findIngredient, writeIngredient } = require('./ingredientStore')
const { fetchIngredient } = require('./spoonacular')
const { resolveIngredient } = require('./resolveIngredient')

const db = {}
const fetched = { id: 20081, name: 'wheat flour', estimatedPrices: { estimatedGramPrice: 0.1 } }

// fresh negative cache per call so tests don't bleed into each other
const opts = (extra = {}) => ({ apiKey: 'k', negativeCache: new Map(), ...extra })

beforeEach(() => jest.clearAllMocks())

describe('resolveIngredient', () => {
  test('cache hit → returns cached, never fetches or writes', async () => {
    findIngredient.mockResolvedValue({ id: 1, name: 'cached' })
    const r = await resolveIngredient(db, 'flour', opts())
    expect(r).toEqual({ id: 1, name: 'cached' })
    expect(fetchIngredient).not.toHaveBeenCalled()
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('miss + no key → null, never fetches (Phase 1 behavior)', async () => {
    findIngredient.mockResolvedValue(null)
    const r = await resolveIngredient(db, 'flour', { negativeCache: new Map() })
    expect(r).toBeNull()
    expect(fetchIngredient).not.toHaveBeenCalled()
  })

  test('miss + key → fetches and registers BOTH the query and canonical name', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue(fetched)
    writeIngredient.mockResolvedValue({ status: 'created' })
    const r = await resolveIngredient(db, 'flour', opts())
    expect(fetchIngredient).toHaveBeenCalledWith('flour', expect.objectContaining({ apiKey: 'k' }))
    expect(writeIngredient).toHaveBeenCalledWith(db, 'flour', fetched)
    expect(writeIngredient).toHaveBeenCalledWith(db, 'wheat flour', fetched) // canonical
    expect(r).toBe(fetched)
  })

  test('does not double-register when query equals canonical name', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue(fetched)
    await resolveIngredient(db, 'Wheat Flour', opts())
    expect(writeIngredient).toHaveBeenCalledTimes(1)
  })

  test('miss + key + no Spoonacular match → null, no write', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue(null)
    const r = await resolveIngredient(db, 'zzz', opts())
    expect(r).toBeNull()
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('an upstream error degrades to null (not a throw / 500)', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockRejectedValue(new Error('Spoonacular rate limit exceeded'))
    const r = await resolveIngredient(db, 'flour', opts())
    expect(r).toBeNull()
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('negative cache: a repeated miss does not re-hit Spoonacular', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue(null)
    const shared = new Map()
    await resolveIngredient(db, 'zzz', { apiKey: 'k', negativeCache: shared })
    await resolveIngredient(db, 'zzz', { apiKey: 'k', negativeCache: shared })
    expect(fetchIngredient).toHaveBeenCalledTimes(1) // second call short-circuited
  })

  test('negative cache entry expires', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue(null)
    const shared = new Map()
    let clock = 1000
    const now = () => clock
    await resolveIngredient(db, 'zzz', { apiKey: 'k', negativeCache: shared, now })
    clock += 11 * 60 * 1000 // past the 10-min TTL
    await resolveIngredient(db, 'zzz', { apiKey: 'k', negativeCache: shared, now })
    expect(fetchIngredient).toHaveBeenCalledTimes(2)
  })

  test('rejects an over-long name before hitting Spoonacular', async () => {
    findIngredient.mockResolvedValue(null)
    const r = await resolveIngredient(db, 'x'.repeat(201), opts())
    expect(r).toBeNull()
    expect(fetchIngredient).not.toHaveBeenCalled()
  })

  test('a fetched doc lacking an id is not cached or served', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue({ name: 'no id', estimatedPrices: {} })
    const r = await resolveIngredient(db, 'flour', opts())
    expect(writeIngredient).not.toHaveBeenCalled()
    expect(r).toBeNull()
  })

  test('write-back failure does not fail the read', async () => {
    findIngredient.mockResolvedValue(null)
    fetchIngredient.mockResolvedValue(fetched)
    writeIngredient.mockRejectedValue(new Error('conflict'))
    const r = await resolveIngredient(db, 'flour', opts())
    expect(r).toBe(fetched)
  })
})
