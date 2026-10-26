import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../middlewares/error-handler'
import { createRateLimiter } from '../middlewares/rate-limit'

process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true'

describe('createRateLimiter', () => {
  it('responde 429 con el formato de error al superar el límite', async () => {
    const app = express()
    app.get(
      '/limited',
      createRateLimiter({ windowMs: 60_000, limit: 2, message: 'Demasiadas pruebas' }),
      (_req, res) => {
        res.json({ data: 'ok' })
      },
    )
    app.use(errorHandler)

    await request(app).get('/limited').expect(200)
    await request(app).get('/limited').expect(200)
    const response = await request(app).get('/limited')

    expect(response.status).toBe(429)
    expect(response.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Demasiadas pruebas' },
    })
    expect(response.headers['retry-after']).toBeDefined()
  })
})
