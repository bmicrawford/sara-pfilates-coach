import { spawn } from 'node:child_process'

const kids = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: process.env }),
  spawn('npx', ['vite', '--port', '43147', '--host'], { stdio: 'inherit', env: process.env, shell: true }),
]

function shut() {
  for (const k of kids) k.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shut)
process.on('SIGTERM', shut)
for (const k of kids) {
  k.on('exit', (code) => {
    if (code && code !== 0) process.exit(code)
  })
}
