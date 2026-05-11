const { normalizeName } = require('./normalizeName')

async function findIngredient(db, name) {
  const normalized = normalizeName(name)
  const nameDoc = await db.collection('ingredient_names').findOne({ name: normalized })
  if (!nameDoc) return null

  const doc = await db.collection('ingredients').findOne({ id: nameDoc.ingredientId })
  return doc ? doc.ingredientData : null
}

// Returns { status: 'created' | 'no-op' | 'conflict', message? }
async function writeIngredient(db, name, ingredientData) {
  const { id } = ingredientData
  const normalized = normalizeName(name)

  await db.collection('ingredients').updateOne(
    { id },
    { $set: { ingredientData } },
    { upsert: true }
  )

  const existing = await db.collection('ingredient_names').findOne({ name: normalized })

  if (existing) {
    if (existing.ingredientId === id) return { status: 'no-op' }
    return {
      status: 'conflict',
      message: `Name "${normalized}" already maps to ingredient ID ${existing.ingredientId}`,
    }
  }

  try {
    await db.collection('ingredient_names').insertOne({ name: normalized, ingredientId: id })
    return { status: 'created' }
  } catch (err) {
    // Race condition: another request inserted the same name between our findOne and insertOne
    if (err.code === 11000) {
      const raceDoc = await db.collection('ingredient_names').findOne({ name: normalized })
      if (raceDoc && raceDoc.ingredientId === id) return { status: 'no-op' }
      return {
        status: 'conflict',
        message: `Name "${normalized}" already maps to ingredient ID ${raceDoc?.ingredientId}`,
      }
    }
    throw err
  }
}

module.exports = { findIngredient, writeIngredient }
