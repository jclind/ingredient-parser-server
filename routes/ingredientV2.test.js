const express = require('express')
const request = require('supertest')

jest.mock('../services/ingredientStore')
const { findIngredient } = require('../services/ingredientStore')

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
  test('returns the neutral projection when found', async () => {
    findIngredient.mockResolvedValue(stored)
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

  test('returns data: null on a cache miss', async () => {
    findIngredient.mockResolvedValue(null)
    const res = await request(buildApp()).get('/v2/ingredient/unobtainium')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: null })
  })

  test('passes the name param to findIngredient', async () => {
    findIngredient.mockResolvedValue(null)
    await request(buildApp()).get('/v2/ingredient/all-purpose%20flour')
    expect(findIngredient).toHaveBeenCalledWith({}, 'all-purpose flour')
  })

  test('returns 500 when findIngredient throws', async () => {
    findIngredient.mockRejectedValue(new Error('db error'))
    const res = await request(buildApp()).get('/v2/ingredient/flour')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error', 'db error')
  })
})
