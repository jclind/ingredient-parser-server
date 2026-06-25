// Exercises the REAL index.js wiring (not a hand-copied replica): the POST-only
// write limiter, the 64kb body cap, and the JSON error handler. index.js guards
// its Mongo connect/listen behind `require.main === module`, so requiring it here
// yields the configured app with no network side effects.

const request = require('supertest')

jest.mock('./services/ingredientStore')
const { findIngredient, writeIngredient } = require('./services/ingredientStore')

// The write limiter reads env at module load — set a low cap BEFORE requiring app.
process.env.WRITE_RATE_LIMIT_MAX = '2'
process.env.WRITE_RATE_LIMIT_WINDOW_MS = '60000'

const app = require('./index')
app.locals.db = {} // DB work is delegated to the mocked store

const flourData = { id: 20081, name: 'wheat flour', estimatedCost: { value: 0.13 } }

beforeEach(() => jest.clearAllMocks())

describe('index.js real wiring', () => {
  test('POST /ingredient is rate-limited at the real mount, GET is not', async () => {
    writeIngredient.mockResolvedValue({ status: 'created' })
    findIngredient.mockResolvedValue(null)
    const post = () =>
      request(app).post('/ingredient').send({ name: 'flour', ingredientData: flourData })

    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(429) // 3rd POST exceeds WRITE_RATE_LIMIT_MAX=2

    // GET reads are never subject to the write limiter, even once POSTs are blocked.
    expect((await request(app).get('/ingredient/flour')).status).toBe(200)
  })

  test('POST body over the 64kb cap → 413 JSON, handler never runs', async () => {
    writeIngredient.mockResolvedValue({ status: 'created' })
    const big = { id: 1, blob: 'x'.repeat(70 * 1024) } // ~70kb > 64kb cap
    const res = await request(app)
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: big })
    expect(res.status).toBe(413)
    expect(res.body).toHaveProperty('error') // JSON shape, not Express's HTML page
    expect(writeIngredient).not.toHaveBeenCalled() // rejected before the handler
  })

  test('malformed JSON body → 400 JSON', async () => {
    const res = await request(app)
      .post('/ingredient')
      .set('Content-Type', 'application/json')
      .send('{ not valid json')
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  test('GET /health is unaffected by the write limiter and body cap', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', service: 'ingredient-parser' })
  })
})
