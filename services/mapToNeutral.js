// Projects a stored ingredient doc (raw Spoonacular / v1-enriched shape) into the
// v2 vendor-neutral wire shape. Pure and defensive: the storage layer is untouched;
// this is purely a read-time projection used by the /v2 route.
//
// Note on image: we return the bare filename, not a resolved CDN URL, so the
// client keeps control of the image size (a display concern).

const asString = v => (typeof v === 'string' ? v : null)
const asFiniteNumber = v =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

// A real nutrition blob is a non-array object with a `nutrients` array. Anything
// else (an array, `{}`, a string) is rejected so the neutral `nutrition` field
// is honestly either a usable object or null.
const asNutrition = n =>
  n && typeof n === 'object' && !Array.isArray(n) && Array.isArray(n.nutrients)
    ? n
    : null

function mapToNeutral(raw) {
  if (!raw || typeof raw !== 'object') return null

  const ep = raw.estimatedPrices || {}
  const cost = raw.estimatedCost || {}

  return {
    name: asString(raw.name) ?? asString(raw.originalName) ?? '',
    category: asString(raw.aisle),
    imageFilename: asString(raw.image),
    possibleUnits: Array.isArray(raw.possibleUnits)
      ? raw.possibleUnits.filter(u => typeof u === 'string')
      : [],
    nutrition: asNutrition(raw.nutrition),
    estimatedPrices: {
      // v1 enrichment writes estimatedPrices (two Spoonacular calls:
      // amount=1&unit=grams and amount=1). Fall back to estimatedCost.value for
      // the per-gram price — for the grams-fetched doc that value IS per-gram
      // cents (verified: it equals estimatedGramPrice on live data).
      perGramCents: asFiniteNumber(ep.estimatedGramPrice) ?? asFiniteNumber(cost.value),
      perUnitCents: asFiniteNumber(ep.estimatedSingleUnitPrice),
    },
  }
}

module.exports = { mapToNeutral }
