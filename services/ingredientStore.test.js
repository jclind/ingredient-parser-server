const { findIngredient, writeIngredient } = require('./ingredientStore')

function makeDb({ nameDoc = null, ingredientDoc = null } = {}) {
  const collections = {
    ingredient_names: {
      findOne: jest.fn().mockResolvedValue(nameDoc),
      insertOne: jest.fn().mockResolvedValue({}),
    },
    ingredients: {
      findOne: jest.fn().mockResolvedValue(ingredientDoc),
      updateOne: jest.fn().mockResolvedValue({}),
    },
  }
  return { collection: (name) => collections[name] }
}

const flourData = {
  id: 20081,
  name: 'wheat flour',
  image: 'flour.png',
  nutrition: {},
  possibleUnits: ['cup', 'g'],
  estimatedCost: { value: 0.13, unit: 'US Cents' },
  aisle: 'Baking',
}

describe('findIngredient', () => {
  test('returns ingredientData on a full cache hit', async () => {
    const db = makeDb({
      nameDoc: { name: 'flour', ingredientId: 20081 },
      ingredientDoc: { id: 20081, ingredientData: flourData },
    })
    const result = await findIngredient(db, 'flour')
    expect(result).toEqual(flourData)
  })

  test('returns null when name is not in the registry', async () => {
    const db = makeDb({ nameDoc: null })
    const result = await findIngredient(db, 'unobtainium')
    expect(result).toBeNull()
  })

  test('returns null when name exists but ingredient document is missing', async () => {
    const db = makeDb({
      nameDoc: { name: 'flour', ingredientId: 20081 },
      ingredientDoc: null,
    })
    const result = await findIngredient(db, 'flour')
    expect(result).toBeNull()
  })

  test('normalizes the name before lookup', async () => {
    const db = makeDb({
      nameDoc: { name: 'all purpose flour', ingredientId: 20081 },
      ingredientDoc: { id: 20081, ingredientData: flourData },
    })
    const namesColl = db.collection('ingredient_names')
    await findIngredient(db, 'All-Purpose Flour ')
    expect(namesColl.findOne).toHaveBeenCalledWith({ name: 'all purpose flour' })
  })
})

describe('writeIngredient', () => {
  test('returns created when name is new', async () => {
    const namesColl = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({}),
    }
    const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
    const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

    const result = await writeIngredient(db, 'flour', flourData)
    expect(result).toEqual({ status: 'created' })
    expect(namesColl.insertOne).toHaveBeenCalledWith({ name: 'flour', ingredientId: 20081 })
  })

  test('returns no-op when name already maps to the same ingredient id', async () => {
    const namesColl = {
      findOne: jest.fn().mockResolvedValue({ name: 'flour', ingredientId: 20081 }),
      insertOne: jest.fn(),
    }
    const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
    const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

    const result = await writeIngredient(db, 'flour', flourData)
    expect(result).toEqual({ status: 'no-op' })
    expect(namesColl.insertOne).not.toHaveBeenCalled()
  })

  // NOTE: writeIngredient uses === to compare ingredientId from the DB against id from
  // ingredientData. If MongoDB ever returns ingredientId as a string (e.g. after a schema
  // migration or manual edit) while id arrives as a number, the comparison silently fails
  // and returns 'conflict' instead of 'no-op'. This test documents that the current
  // implementation does NOT handle mixed types — fix would be to coerce both sides:
  //   existing.ingredientId === id  →  Number(existing.ingredientId) === Number(id)
  test('returns conflict (not no-op) when ingredientId type differs from id type', async () => {
    const namesColl = {
      // ingredientId stored as string, id arrives as number — same logical value, different type
      findOne: jest.fn().mockResolvedValue({ name: 'flour', ingredientId: '20081' }),
      insertOne: jest.fn(),
    }
    const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
    const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

    const result = await writeIngredient(db, 'flour', flourData) // flourData.id is 20081 (number)
    // This should ideally be 'no-op' but the strict === check makes it 'conflict'.
    // If this test starts failing, it means the type coercion bug has been fixed — update
    // the assertion to expect 'no-op' and remove this note.
    expect(result.status).toBe('conflict')
  })

  test('returns conflict when name maps to a different ingredient id', async () => {
    const namesColl = {
      findOne: jest.fn().mockResolvedValue({ name: 'flour', ingredientId: 99999 }),
      insertOne: jest.fn(),
    }
    const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
    const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

    const result = await writeIngredient(db, 'flour', flourData)
    expect(result.status).toBe('conflict')
    expect(result.message).toMatch(/already maps to ingredient ID 99999/)
  })

  test('upserts the ingredient regardless of name conflict status', async () => {
    const namesColl = {
      findOne: jest.fn().mockResolvedValue({ name: 'flour', ingredientId: 20081 }),
      insertOne: jest.fn(),
    }
    const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
    const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

    await writeIngredient(db, 'flour', flourData)
    expect(ingredientsColl.updateOne).toHaveBeenCalledWith(
      { id: 20081 },
      { $set: { ingredientData: flourData } },
      { upsert: true }
    )
  })

  test('normalizes the name before inserting', async () => {
    const namesColl = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({}),
    }
    const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
    const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

    await writeIngredient(db, 'All-Purpose Flour ', flourData)
    expect(namesColl.insertOne).toHaveBeenCalledWith({
      name: 'all purpose flour',
      ingredientId: 20081,
    })
  })

  describe('race condition (duplicate key on insertOne)', () => {
    const dupKeyError = Object.assign(new Error('duplicate key'), { code: 11000 })

    test('returns no-op when race winner inserted the same ingredient id', async () => {
      const namesColl = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null) // before insertOne
          .mockResolvedValueOnce({ name: 'flour', ingredientId: 20081 }), // re-read after error
        insertOne: jest.fn().mockRejectedValue(dupKeyError),
      }
      const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
      const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

      const result = await writeIngredient(db, 'flour', flourData)
      expect(result).toEqual({ status: 'no-op' })
    })

    test('returns conflict when race winner inserted a different ingredient id', async () => {
      const namesColl = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ name: 'flour', ingredientId: 99999 }),
        insertOne: jest.fn().mockRejectedValue(dupKeyError),
      }
      const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
      const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

      const result = await writeIngredient(db, 'flour', flourData)
      expect(result.status).toBe('conflict')
      expect(result.message).toMatch(/99999/)
    })

    test('rethrows non-duplicate-key errors', async () => {
      const unexpectedError = new Error('network failure')
      const namesColl = {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockRejectedValue(unexpectedError),
      }
      const ingredientsColl = { updateOne: jest.fn().mockResolvedValue({}) }
      const db = { collection: (n) => (n === 'ingredient_names' ? namesColl : ingredientsColl) }

      await expect(writeIngredient(db, 'flour', flourData)).rejects.toThrow('network failure')
    })
  })
})
