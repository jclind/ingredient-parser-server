const express = require('express')
const { findIngredient, writeIngredient } = require('../services/ingredientStore')

const router = express.Router()

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
    const { name, ingredientData } = req.body

    if (!name || !ingredientData || ingredientData.id == null) {
      return res.status(400).json({ error: 'name and ingredientData (with id) are required' })
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
