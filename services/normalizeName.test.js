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

  test('collapses internal whitespace runs to a single space', () => {
    expect(normalizeName('all   purpose    flour')).toBe('all purpose flour')
    expect(normalizeName('all\tpurpose\nflour')).toBe('all purpose flour')
  })

  test('hyphen + whitespace variants collapse to the same key', () => {
    expect(normalizeName('All-Purpose  Flour')).toBe('all purpose flour')
    expect(normalizeName('all purpose flour')).toBe('all purpose flour')
    expect(normalizeName('  all--purpose   flour  ')).toBe('all purpose flour')
  })

  test('non-string input → empty string', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
    expect(normalizeName(42)).toBe('')
  })
})
