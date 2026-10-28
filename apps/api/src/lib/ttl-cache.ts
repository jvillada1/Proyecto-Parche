// Caché en memoria con expiración por entrada. Al llenarse descarta la entrada más antigua.
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V) {
    this.entries.delete(key)
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey !== undefined) this.entries.delete(oldestKey)
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  delete(key: string) {
    this.entries.delete(key)
  }
}
