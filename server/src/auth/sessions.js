import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const sessionTokens = new Set()

/** Cookie 只存随机不透明 token；解析时不依赖第三方中间件。 */
export function readSessionToken(cookieHeader = '') {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== 'pg_session') continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return ''
    }
  }
  return ''
}

export function passwordMatches(password, configuredHash) {
  if (typeof password !== 'string' || !/^[a-f\d]{64}$/i.test(configuredHash ?? '')) return false

  const submitted = createHash('sha256').update(password, 'utf8').digest()
  const expected = Buffer.from(configuredHash, 'hex')
  return expected.length === submitted.length && timingSafeEqual(submitted, expected)
}

export function createSessionToken() {
  const token = randomBytes(32).toString('hex')
  sessionTokens.add(token)
  return token
}

export function hasSessionToken(token) {
  return Boolean(token) && sessionTokens.has(token)
}

export function revokeSessionToken(token) {
  if (token) sessionTokens.delete(token)
}

export function requireAuth(req, res, next) {
  const token = readSessionToken(req.headers.cookie)
  if (!hasSessionToken(token)) return res.status(401).json({ error: '请先登录' })
  next()
}
