export class QueueFullError extends Error {
  constructor() {
    super('La cola de peticiones está llena')
    this.name = 'QueueFullError'
  }
}

interface RequestQueueOptions {
  intervalMs: number
  maxPending: number
}

// Ejecuta las tareas de una en una y deja al menos `intervalMs` entre el inicio de cada una.
// Si ya hay `maxPending` tareas esperando, rechaza la nueva en vez de acumular espera sin límite.
export function createRequestQueue({ intervalMs, maxPending }: RequestQueueOptions) {
  let tail: Promise<unknown> = Promise.resolve()
  let nextStartAt = 0
  let pending = 0

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (pending >= maxPending) return Promise.reject(new QueueFullError())
    pending++

    const run = tail.then(async () => {
      const wait = nextStartAt - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      nextStartAt = Date.now() + intervalMs
      return task()
    })
    tail = run.catch(() => undefined)

    return run.finally(() => {
      pending--
    })
  }
}
