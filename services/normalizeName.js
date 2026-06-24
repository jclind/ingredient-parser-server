function normalizeName(name) {
  if (typeof name !== 'string') return ''
  return name.toLowerCase().trim().replace(/-/g, ' ')
}

module.exports = { normalizeName }
