const express = require('express')
const { resolveIngredient } = require('../services/resolveIngredient')
const { mapToNeutral } = require('../services/mapToNeutral')

const router = express.Router()

// GET /v2/ingredient/:name — returns the vendor-neutral projection. On a cache
// miss, if SPOONACULAR_API_KEY is set the server fetches from Spoonacular,
// caches it, and returns it (Phase 2); otherwise `data: null` (Phase 1).
// Always HTTP 200 on a clean miss; 500 on a fetch/DB error.
router.get('/:name', async (req, res) => {
  try {
    const raw = await resolveIngredient(req.app.locals.db, req.params.name, {
      apiKey: process.env.SPOONACULAR_API_KEY,
    })
    res.json({ data: raw ? mapToNeutral(raw) : null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
