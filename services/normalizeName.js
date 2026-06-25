function normalizeName(name) {
  if (typeof name !== 'string') return ''
  // lowercase, hyphens→spaces, then collapse any run of whitespace to a single
  // space and trim — so "All-Purpose  Flour" and "all purpose flour" key the
  // same on both read/write AND in the negative cache.
  return name
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

module.exports = { normalizeName }
