/** Local Node reminder store. The Worker uses KV instead. Never import this from Vite. */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { suppressedEmailSet } from './reminders.mjs'

function resolvePath(filePath) {
  return filePath instanceof URL ? fileURLToPath(filePath) : filePath
}

export function createFileReminderStore(filePath) {
  const file = resolvePath(filePath)
  const records = new Map()
  let suppress = ''
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
      const stored = parsed?.records
      if (stored && typeof stored === 'object') {
        for (const record of Object.values(stored)) {
          if (record && typeof record.email === 'string') records.set(record.email, record)
        }
      }
      if (typeof parsed?.suppress === 'string') suppress = parsed.suppress
    } catch {
      // Missing file until the first sign-up.
    }
  }

  async function persist() {
    const payload = {
      records: Object.fromEntries(records),
      suppress,
    }
    await writeFile(file, JSON.stringify(payload), 'utf8')
  }

  return {
    async get(email) {
      return enqueue(async () => {
        await load()
        const record = records.get(email)
        return record ? { ...record } : null
      })
    },
    async put(record) {
      return enqueue(async () => {
        await load()
        records.set(record.email, { ...record })
        await persist()
      })
    },
    async delete(email) {
      return enqueue(async () => {
        await load()
        records.delete(email)
        await persist()
      })
    },
    async list() {
      return enqueue(async () => {
        await load()
        return [...records.values()].map((record) => ({ ...record }))
      })
    },
    async suppressedSet(envList) {
      return enqueue(async () => {
        await load()
        return suppressedEmailSet(envList, suppress)
      })
    },
  }
}
