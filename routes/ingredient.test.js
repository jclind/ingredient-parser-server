const express = require('express')
const request = require('supertest')

jest.mock('../services/ingredientStore')
const { findIngredient, writeIngredient } = require('../services/ingredientStore')

const { rateLimit } = require('../services/rateLimit')
const ingredientRoutes = require('./ingredient')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.locals.db = {} // routes use app.locals.db but delegate all DB work to the mocked services
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ingredient-parser' }))
  app.use('/ingredient', ingredientRoutes)
  return app
}

// Mirrors index.js: the write limiter wraps POST only, leaving GET unthrottled.
function buildAppWithWriteLimit(max) {
  const app = express()
  app.use(express.json())
  app.locals.db = {}
  const writeLimiter = rateLimit({ max, windowMs: 60_000 })
  app.use(
    '/ingredient',
    (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()),
    ingredientRoutes
  )
  return app
}

const flourData = {
  id: 20081,
  name: 'wheat flour',
  image: 'flour.png',
  nutrition: {},
  possibleUnits: ['cup', 'g'],
  estimatedCost: { value: 0.13, unit: 'US Cents' },
  aisle: 'Baking',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /health', () => {
  test('returns 200 with service name', async () => {
    const res = await request(buildApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'ingredient-parser' })
  })
})

describe('GET /ingredient/:name', () => {
  test('returns data when ingredient is found', async () => {
    findIngredient.mockResolvedValue(flourData)
    const res = await request(buildApp()).get('/ingredient/flour')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: flourData })
  })

  test('returns data: null on a cache miss', async () => {
    findIngredient.mockResolvedValue(null)
    const res = await request(buildApp()).get('/ingredient/unobtainium')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: null })
  })

  test('passes the name param to findIngredient', async () => {
    findIngredient.mockResolvedValue(null)
    await request(buildApp()).get('/ingredient/all-purpose%20flour')
    expect(findIngredient).toHaveBeenCalledWith({}, 'all-purpose flour')
  })

  test('returns 500 when findIngredient throws', async () => {
    findIngredient.mockRejectedValue(new Error('db error'))
    const res = await request(buildApp()).get('/ingredient/flour')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error', 'db error')
  })
})

describe('POST /ingredient', () => {
  test('returns 200 created on a new write', async () => {
    writeIngredient.mockResolvedValue({ status: 'created' })
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: flourData })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'created' })
  })

  test('returns 200 no-op when name already maps to the same id', async () => {
    writeIngredient.mockResolvedValue({ status: 'no-op' })
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: flourData })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'no-op' })
  })

  test('returns 409 when name maps to a different ingredient', async () => {
    writeIngredient.mockResolvedValue({
      status: 'conflict',
      message: 'Name "flour" already maps to ingredient ID 99999',
    })
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: flourData })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already maps to ingredient ID 99999/)
  })

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ ingredientData: flourData })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when ingredientData is missing', async () => {
    const res = await request(buildApp()).post('/ingredient').send({ name: 'flour' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when ingredientData.id is missing', async () => {
    const { id: _id, ...dataWithoutId } = flourData
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: dataWithoutId })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when ingredientData.id is null', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: { ...flourData, id: null } })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when name is an empty string', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: '', ingredientData: flourData })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when name is a non-string', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 42, ingredientData: flourData })
    expect(res.status).toBe(400)
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when name exceeds the length cap', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'x'.repeat(201), ingredientData: flourData })
    expect(res.status).toBe(400)
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when ingredientData is an array', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: [flourData] })
    expect(res.status).toBe(400)
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('returns 400 when ingredientData.id is not a number', async () => {
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: { ...flourData, id: '20081' } })
    expect(res.status).toBe(400)
    expect(writeIngredient).not.toHaveBeenCalled()
  })

  test('write limiter caps POST volume but leaves GET unthrottled', async () => {
    writeIngredient.mockResolvedValue({ status: 'created' })
    findIngredient.mockResolvedValue(null)
    const app = buildAppWithWriteLimit(2)
    const post = () =>
      request(app).post('/ingredient').send({ name: 'flour', ingredientData: flourData })

    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(429) // 3rd POST exceeds max=2

    // GET is not subject to the write limiter even after POSTs are blocked
    const get = await request(app).get('/ingredient/flour')
    expect(get.status).toBe(200)
  })

  test('passes name and ingredientData to writeIngredient', async () => {
    writeIngredient.mockResolvedValue({ status: 'created' })
    await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: flourData })
    expect(writeIngredient).toHaveBeenCalledWith({}, 'flour', flourData)
  })

  test('returns 500 when writeIngredient throws', async () => {
    writeIngredient.mockRejectedValue(new Error('db error'))
    const res = await request(buildApp())
      .post('/ingredient')
      .send({ name: 'flour', ingredientData: flourData })
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error', 'db error')
  })
})
