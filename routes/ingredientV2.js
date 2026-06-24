const express = require('express')
const { findIngredient } = require('../services/ingredientStore')
const { mapToNeutral } = require('../services/mapToNeutral')

const router = express.Router()

// GET /v2/ingredient/:name — same MongoDB lookup as v1, but returns the
// vendor-neutral projection instead of the raw stored shape. Like v1: always
// HTTP 200; `data: null` on a miss. (Phase 2 will fill misses from Spoonacular.)
router.get('/:name', async (req, res) => {
  try {
    const raw = await findIngredient(req.app.locals.db, req.params.name)
    res.json({ data: raw ? mapToNeutral(raw) : null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
