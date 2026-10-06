'use strict'

const fs = require('node:fs')
const mineflayer = require('mineflayer')
const config = require('./config')
const { playerSnapshot } = require('./snapshot')

function safeReason (value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return String(text || 'unknown').slice(0, 500)
}

function connect (options = {}) {
  if (config.auth === 'microsoft') fs.mkdirSync(config.profilesFolder, { recursive: true })
  const state = { bot: null, events: [], connected: false, ended: false, kicked: null }
  const botOptions = {
    host: config.host, port: config.port, version: config.version,
    username: config.alias, auth: config.auth,
    logErrors: false, hideErrors: true
  }
  if (config.auth === 'microsoft') {
    botOptions.profilesFolder = config.profilesFolder
    botOptions.onMsaCode = code => {
      if (options.onMsaCode) options.onMsaCode({ verification_uri: code.verification_uri, user_code: code.user_code, expires_in: code.expires_in })
    }
  }
  const bot = mineflayer.createBot(botOptions)
  state.bot = bot
  const track = (event, detail) => state.events.push({ at: new Date().toISOString(), event, detail })
  bot.on('login', () => { state.connected = true; track('login', { username: bot.username }) })
  bot.on('spawn', () => track('spawn', { dimension: bot.game?.dimension || null }))
  bot.on('respawn', () => track('respawn', { dimension: bot.game?.dimension || null }))
  bot.on('kicked', reason => { state.kicked = safeReason(reason); track('kicked', { reason: state.kicked }) })
  bot.on('error', error => track('error', { message: safeReason(error.message) }))
  bot.on('end', reason => { state.ended = true; track('end', { reason: safeReason(reason) }) })
  return state
}

function waitForSpawn (state, timeoutMs = config.connectTimeoutMs + config.spawnTimeoutMs) {
  return new Promise((resolve, reject) => {
    const bot = state.bot
    let done = false
    const complete = (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      bot.off('spawn', onSpawn)
      bot.off('end', onEnd)
      bot.off('error', onError)
      bot.off('kicked', onKick)
      if (error) reject(error); else resolve(playerSnapshot(bot))
    }
    const onSpawn = () => complete()
    const onEnd = reason => complete(new Error(`Connection ended: ${safeReason(reason)}`))
    const onError = error => complete(new Error(`Client error: ${safeReason(error.message)}`))
    const onKick = reason => complete(new Error(`Kicked: ${safeReason(reason)}`))
    const timer = setTimeout(() => complete(new Error('Timed out waiting for player spawn')), timeoutMs)
    bot.once('spawn', onSpawn)
    bot.once('end', onEnd)
    bot.once('error', onError)
    bot.once('kicked', onKick)
  })
}

async function disconnect (state) {
  if (!state?.bot || state.ended) return 'PASS'
  const bot = state.bot
  bot.clearControlStates?.()
  const ended = new Promise(resolve => bot.once('end', resolve))
  try { bot.quit('Acceptance run complete') } catch { bot.end('Acceptance run complete') }
  if (!state.ended) await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 3000))])
  return state.ended ? 'PASS' : 'FAIL'
}

async function moveBriefly (state, milliseconds = 700) {
  const bot = state.bot
  const before = playerSnapshot(bot).position
  if (!before) throw new Error('No player position before movement')
  bot.setControlState('forward', true)
  try { await new Promise(resolve => setTimeout(resolve, milliseconds)) }
  finally { bot.setControlState('forward', false) }
  await new Promise(resolve => setTimeout(resolve, 300))
  const after = playerSnapshot(bot).position
  const distance = after && Math.hypot(after.x - before.x, after.z - before.z)
  return { before, after, distance, moved: distance != null && distance >= 0.05 }
}

async function queryBackend (state, timeoutMs = 1800) {
  const bot = state.bot
  const messages = []
  const listener = message => messages.push(String(message).slice(0, 300))
  bot.on('messagestr', listener)
  try {
    bot.chat('/server')
    await new Promise(resolve => setTimeout(resolve, timeoutMs))
  } finally { bot.off('messagestr', listener) }
  const match = messages.map(m => m.match(/(?:currently connected to|you are on|current server:?)[\s:]+([a-z0-9_-]+)/i)).find(Boolean)
  return { backend: match ? match[1].toLowerCase() : null, messages }
}

module.exports = { connect, waitForSpawn, disconnect, moveBriefly, queryBackend }
