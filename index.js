require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient } = require('mongodb')
const ingredientRoutes = require('./routes/ingredient')
const ingredientV2Routes = require('./routes/ingredientV2')

const app = express()
const PORT = process.env.PORT || 4001

app.use(cors())
app.use(express.json())

app.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    service: 'ingredient-parser',
    // boolean only — never the key itself; tells us if the running process can
    // see SPOONACULAR_API_KEY (i.e. whether Phase 2 server-side fetch is active)
    spoonacular: !!process.env.SPOONACULAR_API_KEY,
  })
)

app.use('/ingredient', ingredientRoutes)
app.use('/v2/ingredient', ingredientV2Routes)

const MONGO_URI = process.env.MONGO_URI

MongoClient.connect(MONGO_URI)
  .then(async (client) => {
    const db = client.db('prepify')
    app.locals.db = db

    await db.collection('ingredients').createIndex({ id: 1 }, { unique: true })
    await db.collection('ingredient_names').createIndex({ name: 1 }, { unique: true })

    console.log('Connected to MongoDB')
    app.listen(PORT, () => {
      console.log(`Ingredient parser service running on port ${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message)
    process.exit(1)
  })
