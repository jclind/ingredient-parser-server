const { mapToNeutral } = require('./mapToNeutral')

const stored = {
  id: 20081,
  name: 'wheat flour',
  originalName: 'flour',
  image: 'flour.png',
  aisle: 'Baking',
  possibleUnits: ['cup', 'g', 'oz'],
  nutrition: { nutrients: [] },
  estimatedCost: { value: 0.13, unit: 'US Cents' },
  estimatedPrices: { estimatedGramPrice: 0.1, estimatedSingleUnitPrice: 50 },
}

describe('mapToNeutral', () => {
  test('projects a stored doc to the neutral shape', () => {
    expect(mapToNeutral(stored)).toEqual({
      name: 'wheat flour',
      category: 'Baking',
      imageFilename: 'flour.png',
      possibleUnits: ['cup', 'g', 'oz'],
      nutrition: { nutrients: [] },
      estimatedPrices: { perGramCents: 0.1, perUnitCents: 50 },
    })
  })

  test('falls back to originalName when name is missing', () => {
    expect(mapToNeutral({ originalName: 'flour' }).name).toBe('flour')
  })

  test('returns the bare image filename, not a URL (client sizes it)', () => {
    expect(mapToNeutral(stored).imageFilename).toBe('flour.png')
  })

  test('null/undefined doc → null', () => {
    expect(mapToNeutral(null)).toBeNull()
    expect(mapToNeutral(undefined)).toBeNull()
  })

  test('coerces junk fields defensively', () => {
    const r = mapToNeutral({
      name: 123,
      aisle: 7,
      image: {},
      possibleUnits: 'cup',
      nutrition: 'x',
      estimatedPrices: { estimatedGramPrice: 'nope' },
    })
    expect(r).toEqual({
      name: '',
      category: null,
      imageFilename: null,
      possibleUnits: [],
      nutrition: null,
      estimatedPrices: { perGramCents: undefined, perUnitCents: undefined },
    })
  })

  test('missing estimatedPrices → undefined per-unit values (no crash)', () => {
    expect(mapToNeutral({ name: 'x' }).estimatedPrices).toEqual({
      perGramCents: undefined,
      perUnitCents: undefined,
    })
  })

  test('falls back to estimatedCost.value for per-gram price (documented shape)', () => {
    // The README/v1 raw shape: estimatedCost, no estimatedPrices.
    const raw = {
      id: 20081,
      name: 'wheat flour',
      aisle: 'Baking',
      estimatedCost: { value: 0.13, unit: 'US Cents' },
    }
    expect(mapToNeutral(raw).estimatedPrices).toEqual({
      perGramCents: 0.13,
      perUnitCents: undefined,
    })
  })

  test('prefers estimatedPrices over estimatedCost when both present', () => {
    const raw = {
      name: 'x',
      estimatedCost: { value: 9.99 },
      estimatedPrices: { estimatedGramPrice: 0.5, estimatedSingleUnitPrice: 20 },
    }
    expect(mapToNeutral(raw).estimatedPrices).toEqual({
      perGramCents: 0.5,
      perUnitCents: 20,
    })
  })

  test('nutrition must be an object with a nutrients array, else null', () => {
    expect(mapToNeutral({ name: 'x', nutrition: { nutrients: [{ name: 'Fat' }] } }).nutrition).toEqual({
      nutrients: [{ name: 'Fat' }],
    })
    expect(mapToNeutral({ name: 'x', nutrition: {} }).nutrition).toBeNull()
    expect(mapToNeutral({ name: 'x', nutrition: [1, 2] }).nutrition).toBeNull()
  })
})
