/** Local Node entitlement store. The Worker uses KV instead. Never import this from Vite. */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { normalizeEmail } from './redeem.mjs'

function resolvePath(filePath) {
  return filePath instanceof URL ? fileURLToPath(filePath) : filePath
}

export function createFileEntitlementStore(filePath) {
  const file = resolvePath(filePath)
  const emails = new Map()
  const orders = new Map()
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
      const storedEmails = parsed?.emails
      const storedOrders = parsed?.orders
      if (storedEmails && typeof storedEmails === 'object') {
        for (const [email, record] of Object.entries(storedEmails)) {
          const key = normalizeEmail(email)
          if (!key || !record || typeof record !== 'object') continue
          emails.set(key, { ...record, email: key })
        }
      }
      if (storedOrders && typeof storedOrders === 'object') {
        for (const [id, email] of Object.entries(storedOrders)) {
          const key = normalizeEmail(email)
          if (key && emails.has(key)) orders.set(id, key)
        }
      }
    } catch {
      // Missing file until the first grant.
    }
  }

  async function persist() {
    const payload = {
      emails: Object.fromEntries(emails),
      orders: Object.fromEntries(orders),
    }
    await writeFile(file, JSON.stringify(payload), 'utf8')
  }

  return {
    async getEmail(email) {
      return enqueue(async () => {
        await load()
        const row = emails.get(email)
        return row ? { ...row } : null
      })
    },
    async findOrder(keys) {
      return enqueue(async () => {
        await load()
        for (const key of keys || []) {
          const email = orders.get(key)
          if (!email) continue
          const row = emails.get(email)
          if (row) return { ...row }
        }
        return null
      })
    },
    async put(record, orderKeys) {
      return enqueue(async () => {
        await load()
        emails.set(record.email, { ...record })
        for (const key of orderKeys || []) {
          if (!orders.has(key)) orders.set(key, record.email)
        }
        await persist()
      })
    },
    async linkOrders(email, orderKeys) {
      return enqueue(async () => {
        await load()
        if (!emails.has(email)) return
        let changed = false
        for (const key of orderKeys || []) {
          if (!orders.has(key)) {
            orders.set(key, email)
            changed = true
          }
        }
        if (changed) await persist()
      })
    },
  }
}
