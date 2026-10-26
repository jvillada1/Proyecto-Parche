import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'

describe('GET /api/v1/health', () => {
  it('responde 200 con la base de datos conectada', async () => {
    const response = await request(createApp()).get('/api/v1/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { status: 'ok', db: true } })
  })

  it('responde con el formato de error en rutas inexistentes', async () => {
    const response = await request(createApp()).get('/api/v1/no-existe')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})
