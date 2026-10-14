/** A tiny async key-value store: IndexedDB in the browser, memory in tests or when storage is blocked. */

export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Keys starting with `prefix`, in key order. */
  keys(prefix: string): Promise<string[]>
  /** False when nothing survives a reload (no IndexedDB). */
  readonly persistent: boolean
}

export class MemoryKV implements KV {
  readonly persistent = false
  private map = new Map<string, unknown>()

  async get<T>(key: string) {
    return structuredClone(this.map.get(key)) as T | undefined
  }

  async set(key: string, value: unknown) {
    this.map.set(key, structuredClone(value))
  }

  async delete(key: string) {
    this.map.delete(key)
  }

  async keys(prefix: string) {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort()
  }
}

const STORE = 'kv'

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

class IdbKV implements KV {
  readonly persistent = true
  private db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE)
  }

  get<T>(key: string) {
    return done(this.store('readonly').get(key)) as Promise<T | undefined>
  }

  async set(key: string, value: unknown) {
    await done(this.store('readwrite').put(value, key))
  }

  async delete(key: string) {
    await done(this.store('readwrite').delete(key))
  }

  async keys(prefix: string) {
    // '￿' sorts after every character a key uses, so this is "starts with".
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
    return (await done(this.store('readonly').getAllKeys(range))).map(String)
  }
}

/** Opens the browser's IndexedDB store, or a memory store when it isn't available. */
export async function openKV(name = 'braincraft'): Promise<KV> {
  try {
    if (!globalThis.indexedDB) return new MemoryKV()
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    return new IdbKV(await done(req))
  } catch {
    return new MemoryKV()
  }
}
