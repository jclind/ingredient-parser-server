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
// Only POST /ingredient carries a body (a single ingredient doc, a few KB at
// most). Cap it well below the 100kb default so an oversized poison payload is
// rejected by the parser before it reaches a handler.
app.use(express.json({ limit: '64kb' }))

// Rate-limit writes to the shared cache (POST /ingredient) without throttling
// the cheap cached reads (GET). The v1 client write-back has no auth, so this is
// the volume guard against cache-write spam. Tunable via env.
const writeLimiter = rateLimit({
  windowMs: Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.WRITE_RATE_LIMIT_MAX) || 60,
})

app.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    service: 'ingredient-parser',
    // boolean only — never the key itself; tells us if the running process can
    // see SPOONACULAR_API_KEY (i.e. whether Phase 2 server-side fetch is active)
    spoonacular: !!process.env.SPOONACULAR_API_KEY,
  })
)

app.use(
  '/ingredient',
  (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()),
  ingredientRoutes
)
// Rate-limit the paid /v2 path (Spoonacular-backed). Tunable via env.
app.use(
  '/v2/ingredient',
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    max: Number(process.env.RATE_LIMIT_MAX) || 120,
  }),
  ingredientV2Routes
)

// Centralized error handler — keep the API's JSON { error } shape for body-parser
// failures (oversized body → 413, malformed JSON → 400) rather than Express's
// default HTML error page. Must be registered after the routes.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' })
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' })
  console.error(`[error] ${err.message}`)
  res.status(err.status || 500).json({ error: 'Internal server error' })
})

const MONGO_URI = process.env.MONGO_URI

async function start() {
  try {
    const client = await MongoClient.connect(MONGO_URI)
    const db = client.db('prepify')
    app.locals.db = db

    await db.collection('ingredients').createIndex({ id: 1 }, { unique: true })
    await db.collection('ingredient_names').createIndex({ name: 1 }, { unique: true })

    console.log('Connected to MongoDB')
    app.listen(PORT, () => {
      console.log(`Ingredient parser service running on port ${PORT}`)
    })
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message)
    process.exit(1)
  }
}

// Connect + listen only when run directly (`node index.js`). When required by a
// test, just export the configured app so the real wiring can be exercised.
if (require.main === module) start()

module.exports = app
