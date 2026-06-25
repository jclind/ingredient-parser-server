require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient } = require('mongodb')
const ingredientRoutes = require('./routes/ingredient')
const ingredientV2Routes = require('./routes/ingredientV2')
const { rateLimit } = require('./services/rateLimit')

const app = express()
const PORT = process.env.PORT || 4001

// Behind Railway's edge proxy — trust the first hop so req.ip reflects the real
// client (X-Forwarded-For), which the rate limiter keys on.
app.set('trust proxy', 1)

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
// Rate-limit the paid /v2 path (Spoonacular-backed). Tunable via env.
app.use(
  '/v2/ingredient',
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    max: Number(process.env.RATE_LIMIT_MAX) || 120,
  }),
  ingredientV2Routes
)

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
