import { describe, expect, it } from 'vitest'
import { QueueFullError, createRequestQueue } from '../lib/request-queue'

describe('createRequestQueue', () => {
  it('ejecuta las tareas de una en una y separadas por el intervalo', async () => {
    const enqueue = createRequestQueue({ intervalMs: 100, maxPending: 10 })
    const startedAt: number[] = []
    let running = 0
    let maxRunning = 0

    await Promise.all(
      Array.from({ length: 3 }, () =>
        enqueue(async () => {
          startedAt.push(Date.now())
          running++
          maxRunning = Math.max(maxRunning, running)
          await new Promise((resolve) => setTimeout(resolve, 10))
          running--
        }),
      ),
    )

    expect(maxRunning).toBe(1)
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(95)
    expect(startedAt[2]! - startedAt[1]!).toBeGreaterThanOrEqual(95)
  })

  it('rechaza con QueueFullError cuando hay demasiadas tareas pendientes', async () => {
    const enqueue = createRequestQueue({ intervalMs: 50, maxPending: 2 })

    const accepted = [enqueue(async () => 1), enqueue(async () => 2)]
    const rejected = enqueue(async () => 3)

    await expect(rejected).rejects.toBeInstanceOf(QueueFullError)
    expect(await Promise.all(accepted)).toEqual([1, 2])
    await expect(enqueue(async () => 4)).resolves.toBe(4)
  })

  it('una tarea que falla no detiene la cola', async () => {
    const enqueue = createRequestQueue({ intervalMs: 0, maxPending: 10 })

    const failed = enqueue(async () => {
      throw new Error('falló')
    })
    const next = enqueue(async () => 'ok')

    await expect(failed).rejects.toThrow('falló')
    await expect(next).resolves.toBe('ok')
  })
})
