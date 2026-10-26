import mongoose from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'

describe('GET /api/v1/health (MongoDB real)', () => {
  it('informa ok con la base conectada y degraded cuando se pierde la conexión', async () => {
    const app = createApp()

    const connected = await request(app).get('/api/v1/health')
    expect(connected.status).toBe(200)
    expect(connected.body).toEqual({ data: { status: 'ok', db: true } })

    await mongoose.disconnect()
    try {
      const disconnected = await request(app).get('/api/v1/health')
      expect(disconnected.status).toBe(503)
      expect(disconnected.body).toEqual({ data: { status: 'degraded', db: false } })
    } finally {
      await mongoose.connect(process.env.MONGODB_URI as string)
    }
  })
})
