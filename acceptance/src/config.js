'use strict'

const path = require('node:path')

const VERSION = '26.2'
const TARGET = process.env.MC_ACCEPTANCE_TARGET || 'local-lab'
if (!['production', 'local-lab'].includes(TARGET)) throw new Error(`Unsupported acceptance target: ${TARGET}`)
const LOCAL = TARGET === 'local-lab'
const HOST = LOCAL ? '127.0.0.1' : 'portal.hanksfirewood.com'
const PORT = LOCAL ? 25590 : 25565
const RUNTIME = process.env.MC_ACCEPTANCE_RUNTIME || 'C:\\MinecraftAI\\AcceptanceRuntime'

module.exports = Object.freeze({
  target: TARGET,
  version: VERSION,
  host: HOST,
  port: PORT,
  runtime: RUNTIME,
  auth: LOCAL ? 'offline' : 'microsoft',
  profilesFolder: path.join(RUNTIME, 'auth'),
  reportsFolder: path.join(RUNTIME, 'reports', TARGET),
  alias: process.env.MC_ACCEPTANCE_AUTH_ALIAS || 'CodexTestBot',
  // First Microsoft device authorization can take several minutes.
  connectTimeoutMs: 600000,
  spawnTimeoutMs: 30000
})
