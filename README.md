# Prepify Ingredient Parser Service

A lightweight Express service that acts as a read/write cache for Spoonacular ingredient data, backed by MongoDB. The client (not this server) is responsible for calling Spoonacular — this service only stores and retrieves results.

---

## How It Fits In

```
Client
  │
  ├── GET /ingredient/:name  ──────────────────► MongoDB lookup
  │       hit → return data                          │
  │       miss → client calls Spoonacular directly   │
  │               └── POST /ingredient (fire-and-forget write-back)
  │
  └── GET /health
```

The server never calls Spoonacular. It is purely a cache layer.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A MongoDB Atlas cluster (or local MongoDB instance)

### Local Setup

```bash
cd server-ingredients
npm install
cp .env.example .env   # fill in MONGO_URI
npm run dev            # starts with nodemon on port 4001
```

The server will connect to MongoDB, create the required indexes (idempotent), and start listening.

---

## Environment Variables

| Variable   | Required | Default | Description                        |
|------------|----------|---------|------------------------------------|
| `MONGO_URI` | Yes      | —       | MongoDB connection string          |
| `PORT`      | No       | `4001`  | Port the server listens on         |

```
# .env
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/prepify?retryWrites=true&w=majority
PORT=4001
```

---

## API Reference

Base URL: `http://localhost:4001` (local) or your Railway deployment URL.

---

### GET /health

Health check used by Railway and uptime monitors.

**Response:**
```json
{ "status": "ok", "service": "ingredient-parser" }
```

---

### GET /ingredient/:name

Looks up an ingredient by name. The name is normalized before lookup (see [Name Normalization](#name-normalization)), so `"All-Purpose Flour"`, `"all purpose flour"`, and `"all-purpose flour"` all resolve to the same entry.

Always returns HTTP 200. Returns `data: null` when not found — never a 404.

**Example — found:**
```bash
curl http://localhost:4001/ingredient/flour
```
```json
{
  "data": {
    "id": 20081,
    "name": "wheat flour",
    "image": "flour.png",
    "nutrition": { ... },
    "possibleUnits": ["cup", "g", "oz", "tbsp"],
    "estimatedCost": { "value": 0.13, "unit": "US Cents" },
    "aisle": "Baking"
  }
}
```

**Example — not found:**
```bash
curl http://localhost:4001/ingredient/unobtainium
```
```json
{ "data": null }
```

**Using fetch:**
```js
const res = await fetch(`${INGREDIENT_SERVICE_URL}/ingredient/${encodeURIComponent(name)}`)
const { data } = await res.json()
// data is null (miss) or a raw Spoonacular object (hit)
```

---

### POST /ingredient

Stores an ingredient and registers its name in the name registry. Used as a fire-and-forget write-back after the client fetches from Spoonacular.

No authentication required.

**Request body:**
```json
{
  "name": "flour",
  "ingredientData": {
    "id": 20081,
    "name": "wheat flour",
    "image": "flour.png",
    "nutrition": { ... },
    "possibleUnits": ["cup", "g", "oz"],
    "estimatedCost": { "value": 0.13, "unit": "US Cents" },
    "aisle": "Baking"
  }
}
```

`ingredientData` is the raw Spoonacular response object. The `id` field (Spoonacular ID) must be present.

**Responses:**

| Status | Body | Meaning |
|--------|------|---------|
| 200 | `{ "status": "created" }` | Name registered, ingredient stored |
| 200 | `{ "status": "no-op" }` | Name already mapped to this same ingredient — nothing changed |
| 400 | `{ "error": "..." }` | Missing `name` or `ingredientData.id` |
| 409 | `{ "error": "Name \"flour\" already maps to ingredient ID 12345" }` | Name is taken by a different ingredient |

**Example — write-back after a Spoonacular fetch:**
```js
// Fire and forget — do not await, do not block on errors
fetch(`${INGREDIENT_SERVICE_URL}/ingredient`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: searchedName, ingredientData: spoonacularResult }),
}).catch(() => {})
```

---

## Name Normalization

Every name is normalized the same way before storage or lookup:

```
"All-Purpose Flour " → "all purpose flour"
```

Rules applied in order:
1. Lowercase
2. Trim whitespace
3. Replace hyphens with spaces

This means you can safely register `"all-purpose flour"` and look it up as `"all purpose flour"` — they are the same key. A single name maps to exactly one ingredient ID. The same ingredient can have multiple names registered under it.

---

## Data Model

Two MongoDB collections in the `prepify` database:

### `ingredients`

One document per unique Spoonacular ingredient, keyed by Spoonacular ID.

```json
{
  "_id": ObjectId("..."),
  "id": 20081,
  "ingredientData": {
    "id": 20081,
    "name": "wheat flour",
    "image": "flour.png",
    "nutrition": { ... },
    "possibleUnits": ["cup", "g", "oz"],
    "estimatedCost": { "value": 0.13, "unit": "US Cents" },
    "aisle": "Baking"
  }
}
```

Unique index on `id`.

---

### `ingredient_names`

Global name registry. One document per registered name.

```json
{ "name": "flour",            "ingredientId": 20081 }
{ "name": "all purpose flour","ingredientId": 20081 }
{ "name": "wheat flour",      "ingredientId": 20081 }
```

Multiple names can point to the same `ingredientId`. A name can only point to one `ingredientId`. Unique index on `name`.

Indexes for both collections are created automatically when the server starts.

---

## Code Structure

```
server-ingredients/
├── index.js                     # Entry point: Express setup, MongoDB connect, index creation
├── routes/
│   └── ingredient.js            # GET /ingredient/:name  and  POST /ingredient
└── services/
    ├── ingredientStore.js       # findIngredient() and writeIngredient() — all DB logic
    └── normalizeName.js         # Name normalization function
```

**`index.js`** — Connects to MongoDB, ensures indexes exist, then mounts routes and starts the server. The `db` instance is attached to `app.locals.db` so all routes can access it without importing a global connection.

**`routes/ingredient.js`** — Thin HTTP layer. Validates request shape, calls service functions, maps results to HTTP responses. No DB access directly.

**`services/ingredientStore.js`** — All database logic lives here. `findIngredient` does a two-step lookup: name registry → ingredient collection. `writeIngredient` upserts the ingredient then registers the name, handling conflicts and duplicate key race conditions.

**`services/normalizeName.js`** — Single pure function. Imported by both `ingredientStore.js` (for storage/lookup) and available for client-side use if you need to pre-normalize a name before sending it.

---

## Write Conflict Behavior

When `POST /ingredient` is called with a name that already exists in `ingredient_names`:

- If it maps to the **same** Spoonacular ID → `no-op` (safe to call repeatedly)
- If it maps to a **different** Spoonacular ID → `409 Conflict` (the name is taken)

The unique index on `ingredient_names.name` enforces this at the database level, so even concurrent writes cannot create duplicates. The service handles the resulting duplicate key error (MongoDB error code `11000`) and returns an appropriate response.

---

## Deploying to Railway

1. Create a new Railway project
2. Set the root directory to `server-ingredients/`
3. Add environment variables: `MONGO_URI` and optionally `PORT`
4. Deploy — Railway uses `railway.json` and `npm start` automatically
