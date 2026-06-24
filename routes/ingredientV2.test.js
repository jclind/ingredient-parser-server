const express = require('express')
const request = require('supertest')

jest.mock('../services/resolveIngredient')
const { resolveIngredient } = require('../services/resolveIngredient')

const v2Routes = require('./ingredientV2')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.locals.db = {}
  app.use('/v2/ingredient', v2Routes)
  return app
}

const stored = {
  id: 20081,
  name: 'wheat flour',
  image: 'flour.png',
  aisle: 'Baking',
  possibleUnits: ['cup', 'g'],
  nutrition: { nutrients: [] },
  estimatedPrices: { estimatedGramPrice: 0.1, estimatedSingleUnitPrice: 50 },
}

beforeEach(() => jest.clearAllMocks())

describe('GET /v2/ingredient/:name', () => {
  test('returns the neutral projection when resolved', async () => {
    resolveIngredient.mockResolvedValue(stored)
    const res = await request(buildApp()).get('/v2/ingredient/flour')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: {
        name: 'wheat flour',
        category: 'Baking',
        imageFilename: 'flour.png',
        possibleUnits: ['cup', 'g'],
        nutrition: { nutrients: [] },
        estimatedPrices: { perGramCents: 0.1, perUnitCents: 50 },
      },
    })
  })

  test('returns data: null on a miss', async () => {
    resolveIngredient.mockResolvedValue(null)
    const res = await request(buildApp()).get('/v2/ingredient/unobtainium')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: null })
  })

  test('passes the name and the configured api key to resolveIngredient', async () => {
    process.env.SPOONACULAR_API_KEY = 'test-key'
    resolveIngredient.mockResolvedValue(null)
    await request(buildApp()).get('/v2/ingredient/all-purpose%20flour')
    expect(resolveIngredient).toHaveBeenCalledWith({}, 'all-purpose flour', {
      apiKey: 'test-key',
    })
    delete process.env.SPOONACULAR_API_KEY
  })

  test('returns 500 when resolveIngredient throws', async () => {
    resolveIngredient.mockRejectedValue(new Error('spoonacular down'))
    const res = await request(buildApp()).get('/v2/ingredient/flour')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error', 'spoonacular down')
  })
})
