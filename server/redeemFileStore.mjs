/** Local Node redeem store. The Worker uses KV instead. Never import this from Vite. */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { normalizeToken, sanitizeRecord } from './redeem.mjs'

function resolvePath(filePath) {
  return filePath instanceof URL ? fileURLToPath(filePath) : filePath
}

export function createFileRedeemStore(filePath) {
  const file = resolvePath(filePath)
  const tokens = new Map()
  const external = new Map()
  let loaded = false
  let chain = Promise.resolve()

  function enqueue(task) {
    const run = chain.then(task, task)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      const storedTokens = parsed?.tokens
      const storedExternal = parsed?.external
      if (storedTokens && typeof storedTokens === 'object') {
        for (const value of Object.values(storedTokens)) {
          const record = sanitizeRecord(value)
          if (record) tokens.set(record.token, record)
        }
      }
      if (storedExternal && typeof storedExternal === 'object') {
        for (const [id, token] of Object.entries(storedExternal)) {
          const key = normalizeToken(token)
          if (tokens.has(key)) external.set(id, key)
        }
      }
    } catch {
      // Missing file on first mint.
    }
  }

  async function persist() {
    const payload = {
      tokens: Object.fromEntries(tokens),
      external: Object.fromEntries(external),
    }
    await writeFile(file, JSON.stringify(payload), 'utf8')
  }

  return {
    async get(token) {
      return enqueue(async () => {
        await load()
        const record = tokens.get(token)
        return record ? { ...record } : null
      })
    },
    async put(token, record) {
      return enqueue(async () => {
        await load()
        tokens.set(token, { ...record })
        await persist()
      })
    },
    async getExternal(id) {
      return enqueue(async () => {
        await load()
        return external.get(id) || null
      })
    },
    async putExternal(id, token) {
      return enqueue(async () => {
        await load()
        external.set(id, token)
        await persist()
      })
    },
  }
}
