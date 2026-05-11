function normalizeName(name) {
  return name.toLowerCase().trim().replace(/-/g, ' ')
}

module.exports = { normalizeName }
