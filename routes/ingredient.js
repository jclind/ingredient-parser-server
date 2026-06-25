const express = require('express')
const { findIngredient, writeIngredient } = require('../services/ingredientStore')

const router = express.Router()

const MAX_NAME_LENGTH = 200

router.get('/:name', async (req, res) => {
  try {
    const data = await findIngredient(req.app.locals.db, req.params.name)
    res.json({ data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, ingredientData } = req.body || {}

    // This route writes the body verbatim into the shared cache (read by both v1
    // and v2), so validate the shape before trusting it. The rate limiter (wired
    // at mount time) caps write volume; this caps write *shape*.
    if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
      return res
        .status(400)
        .json({ error: `name must be a non-empty string up to ${MAX_NAME_LENGTH} chars` })
    }
    if (
      !ingredientData ||
      typeof ingredientData !== 'object' ||
      Array.isArray(ingredientData) ||
      typeof ingredientData.id !== 'number' ||
      !Number.isFinite(ingredientData.id)
    ) {
      return res
        .status(400)
        .json({ error: 'ingredientData must be an object with a numeric id' })
    }

    const result = await writeIngredient(req.app.locals.db, name, ingredientData)

    if (result.status === 'conflict') {
      return res.status(409).json({ error: result.message })
    }

    res.json({ status: result.status })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
