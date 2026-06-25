// Lightweight, dependency-free fixed-window rate limiter.
//
// Protects the paid, unauthenticated /v2 route: each client IP gets `max`
// requests per `windowMs`; over that → 429. In-memory and per-process (resets
// on restart, not shared across instances) — sufficient as a first line of
// defense in front of Spoonacular cost. For multi-instance / distributed limits
// swap in `express-rate-limit` with a shared (Redis) store; this is a drop-in.
//
// Timer-free: stale IPs are swept opportunistically when the map grows, so
// there are no open handles to leak in tests or to keep the process alive.

const defaultKey = req => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'
const SWEEP_THRESHOLD = 10000

function rateLimit({ windowMs = 60_000, max = 120, now = Date.now, key = defaultKey } = {}) {
  const hits = new Map()

  return function rateLimitMiddleware(req, res, next) {
    const t = now()

    // opportunistic cleanup so the map can't grow unbounded under distinct IPs
    if (hits.size > SWEEP_THRESHOLD) {
      for (const [k, v] of hits) if (t - v.windowStart >= windowMs) hits.delete(k)
    }

    const id = key(req)
    let entry = hits.get(id)
    if (!entry || t - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: t }
      hits.set(id, entry)
    }
    entry.count++

    res.setHeader('RateLimit-Limit', max)
    res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count))

    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.windowStart + windowMs - t) / 1000))
      return res.status(429).json({ error: 'Too many requests' })
    }
    next()
  }
}

module.exports = { rateLimit }
