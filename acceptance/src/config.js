'use strict'

const path = require('node:path')

const VERSION = '26.2'
const HOST = 'portal.hanksfirewood.com'
const PORT = 25565
const RUNTIME = process.env.MC_ACCEPTANCE_RUNTIME || 'C:\\MinecraftAI\\AcceptanceRuntime'

module.exports = Object.freeze({
  version: VERSION,
  host: HOST,
  port: PORT,
  runtime: RUNTIME,
  profilesFolder: path.join(RUNTIME, 'auth'),
  reportsFolder: path.join(RUNTIME, 'reports'),
  alias: process.env.MC_ACCEPTANCE_AUTH_ALIAS || 'CodexTestBot',
  // First Microsoft device authorization can take several minutes.
  connectTimeoutMs: 600000,
  spawnTimeoutMs: 30000
})
