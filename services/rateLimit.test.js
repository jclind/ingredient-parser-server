const { rateLimit } = require('./rateLimit')

// minimal req/res doubles
const mkReq = ip => ({ ip })
function mkRes() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}
const run = (mw, ip) => {
  const req = mkReq(ip), res = mkRes()
  let nexted = false
  mw(req, res, () => { nexted = true })
  return { res, nexted }
}

describe('rateLimit', () => {
  test('allows up to max, then 429s', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 60000, max: 3, now: () => clock })
    for (let i = 0; i < 3; i++) expect(run(mw, 'a').nexted).toBe(true)
    const blocked = run(mw, 'a')
    expect(blocked.nexted).toBe(false)
    expect(blocked.res.statusCode).toBe(429)
    expect(blocked.res.body).toEqual({ error: 'Too many requests' })
  })

  test('limits are per-IP', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 60000, max: 1, now: () => clock })
    expect(run(mw, 'a').nexted).toBe(true)
    expect(run(mw, 'a').nexted).toBe(false) // a is over
    expect(run(mw, 'b').nexted).toBe(true) // b is independent
  })

  test('window resets after windowMs', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 60000, max: 1, now: () => clock })
    expect(run(mw, 'a').nexted).toBe(true)
    expect(run(mw, 'a').nexted).toBe(false)
    clock += 60001
    expect(run(mw, 'a').nexted).toBe(true) // new window
  })

  test('sets RateLimit headers and Retry-After on block', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 60000, max: 1, now: () => clock })
    const ok = run(mw, 'a')
    expect(ok.res.headers['RateLimit-Limit']).toBe(1)
    expect(ok.res.headers['RateLimit-Remaining']).toBe(0)
    const blocked = run(mw, 'a')
    expect(blocked.res.headers['Retry-After']).toBe(60)
  })

  test('falls back to socket address when req.ip is absent', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 60000, max: 1, now: () => clock })
    const req = { socket: { remoteAddress: '1.2.3.4' } }, res = mkRes()
    let n = 0
    mw(req, res, () => n++)
    mw(req, res, () => n++)
    expect(n).toBe(1) // second blocked → same key
  })
})
