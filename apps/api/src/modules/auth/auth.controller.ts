import type { CookieOptions, RequestHandler, Response } from 'express'
import { env } from '../../config/env'
import { REFRESH_TOKEN_TTL_MS } from '../../lib/tokens'
import { UnauthorizedError } from '../../utils/app-error'
import * as authService from './auth.service'

export const REFRESH_COOKIE_NAME = 'refreshToken'

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
  maxAge: REFRESH_TOKEN_TTL_MS,
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions)
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions, maxAge: undefined })
}

export const registerManager: RequestHandler = async (req, res) => {
  const { user, business, accessToken, refreshToken } = await authService.registerManager(
    req.body,
    req.get('user-agent'),
  )

  setRefreshCookie(res, refreshToken)
  res.status(201).json({ data: { accessToken, user, business } })
}

export const login: RequestHandler = async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(
    req.body,
    req.get('user-agent'),
  )

  setRefreshCookie(res, refreshToken)
  res.json({ data: { accessToken, user } })
}

export const refresh: RequestHandler = async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new UnauthorizedError('No hay sesión activa')
  }

  try {
    const session = await authService.refreshSession(refreshToken, req.get('user-agent'))
    setRefreshCookie(res, session.refreshToken)
    res.json({ data: { accessToken: session.accessToken } })
  } catch (error) {
    clearRefreshCookie(res)
    throw error
  }
}

export const me: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError()

  res.json({ data: await authService.getMe(req.auth.userId) })
}

export const changePassword: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError()

  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]
  await authService.changePassword(
    req.auth.userId,
    req.body,
    typeof refreshToken === 'string' && refreshToken ? refreshToken : undefined,
  )
  res.json({ data: { message: 'Contraseña actualizada correctamente' } })
}

export const logout: RequestHandler = async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]
  if (typeof refreshToken === 'string' && refreshToken) await authService.logout(refreshToken)

  clearRefreshCookie(res)
  res.status(204).end()
}
