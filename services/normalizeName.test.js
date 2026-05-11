const { normalizeName } = require('./normalizeName')

describe('normalizeName', () => {
  test('lowercases the input', () => {
    expect(normalizeName('FLOUR')).toBe('flour')
  })

  test('trims leading and trailing whitespace', () => {
    expect(normalizeName('  flour  ')).toBe('flour')
  })

  test('replaces hyphens with spaces', () => {
    expect(normalizeName('all-purpose flour')).toBe('all purpose flour')
  })

  test('replaces multiple hyphens', () => {
    expect(normalizeName('gluten-free all-purpose')).toBe('gluten free all purpose')
  })

  test('applies all transformations together', () => {
    expect(normalizeName('  All-Purpose Flour  ')).toBe('all purpose flour')
  })

  test('handles a name that needs no changes', () => {
    expect(normalizeName('flour')).toBe('flour')
  })

  test('handles an empty string', () => {
    expect(normalizeName('')).toBe('')
  })
})
