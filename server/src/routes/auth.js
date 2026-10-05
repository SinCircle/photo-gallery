import { Router } from 'express'
import {
  createSessionToken,
  hasSessionToken,
  passwordMatches,
  readSessionToken,
  revokeSessionToken,
} from '../auth/sessions.js'

export function authRouter(cfg) {
  const router = Router()

  router.post('/login', (req, res) => {
    if (!passwordMatches(req.body?.password, cfg.adminPasswordHash)) {
      return res.status(401).json({ error: '密码错误' })
    }

    const token = createSessionToken()
    res.setHeader('Set-Cookie', `pg_session=${token}; HttpOnly; SameSite=Lax; Path=/`)
    res.json({ authenticated: true })
  })

  router.post('/logout', (req, res) => {
    revokeSessionToken(readSessionToken(req.headers.cookie))
    res.setHeader('Set-Cookie', 'pg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    res.json({ authenticated: false })
  })

  router.get('/session', (req, res) => {
    res.json({ authenticated: hasSessionToken(readSessionToken(req.headers.cookie)) })
  })

  return router
}
