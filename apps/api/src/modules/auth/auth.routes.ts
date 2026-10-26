import { Router } from 'express'
import { loginRateLimiter, registerRateLimiter } from '../../middlewares/rate-limit'
import { validate } from '../../middlewares/validate'
import { loginSchema, registerManagerSchema } from './auth.schemas'
import * as authController from './auth.controller'

export const authRoutes = Router()

authRoutes.post(
  '/register/manager',
  registerRateLimiter,
  validate({ body: registerManagerSchema }),
  authController.registerManager,
)

authRoutes.post('/login', validate({ body: loginSchema }), loginRateLimiter, authController.login)

authRoutes.post('/refresh', authController.refresh)
authRoutes.post('/logout', authController.logout)
