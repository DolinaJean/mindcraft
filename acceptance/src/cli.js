#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const config = require('./config')
const client = require('./client')
const { newReport, addStep, finish, save } = require('./report')

const usage = `Minecraft Acceptance Bot (Java 26.2)
  status                 Show configuration and authentication cache presence
  connect                Authenticate, join through Velocity, report player state, disconnect
  whereami               Join and inspect player identity, position, dimension, backend evidence
  inventory              Join and report complete client inventory
  test smoke             Join, inspect, move briefly, query backend, disconnect
  test local-smoke       Launch isolated offline Paper + Velocity lab, run smoke, stop lab
  report latest          Print latest JSON run report
  cleanup <run-id>       Explain recovery status for a run
  --dry-run              Show intended steps without connecting
`

function status () {
  const authExists = config.auth === 'microsoft' && fs.existsSync(config.profilesFolder) && fs.readdirSync(config.profilesFolder).length > 0
  let lastVerifiedLogin = null
  if (fs.existsSync(config.reportsFolder)) {
    const files = fs.readdirSync(config.reportsFolder).filter(name => name.endsWith('.json')).sort().reverse()
    for (const name of files) {
      const report = JSON.parse(fs.readFileSync(path.join(config.reportsFolder, name), 'utf8'))
      if (report.player_uuid && report.steps?.some(step => step.name === 'player_spawn' && step.result === 'AUTOMATED PASS')) {
        lastVerifiedLogin = { run_id: report.run_id, at: report.started_at, player_uuid: report.player_uuid }
        break
      }
    }
  }
  return { target: config.target, endpoint: `${config.host}:${config.port}`, version: config.version, authentication: config.auth,
    authAlias: config.alias, authCachePresent: authExists, authCachePath: config.auth === 'microsoft' ? config.profilesFolder : null,
    reportPath: config.reportsFolder, playerLoginVerified: Boolean(lastVerifiedLogin), lastVerifiedLogin }
}

function latest () {
  if (!fs.existsSync(config.reportsFolder)) throw new Error('No reports yet')
  const files = fs.readdirSync(config.reportsFolder).filter(name => name.endsWith('.json'))
  if (!files.length) throw new Error('No reports yet')
  files.sort((a, b) => fs.statSync(path.join(config.reportsFolder, b)).mtimeMs - fs.statSync(path.join(config.reportsFolder, a)).mtimeMs)
  return JSON.parse(fs.readFileSync(path.join(config.reportsFolder, files[0]), 'utf8'))
}

function cleanup (runId) {
  if (!/^[0-9TZ-]+-[a-f0-9]{6}$/.test(runId)) throw new Error('Invalid run ID')
  const file = path.join(config.reportsFolder, `${runId}.json`)
  if (!fs.existsSync(file)) throw new Error('Run not found')
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (report.cleanup === 'PASS') return { run_id: runId, cleanup: 'PASS', detail: 'Bot disconnected; no fixtures were created by milestone 1.' }
  return { run_id: runId, cleanup: report.cleanup, detail: 'Inspect this run before any fixture cleanup. Milestone 1 never creates world fixtures.' }
}

async function run (command) {
  const report = newReport(command)
  let state
  try {
    state = client.connect({ onMsaCode: code => {
      console.error(`Microsoft sign-in required. Open ${code.verification_uri} and enter code ${code.user_code}. The code expires in ${code.expires_in} seconds.`)
    } })
    const snap = await client.waitForSpawn(state)
    report.player_uuid = snap.uuid
    addStep(report, 'player_spawn', 'AUTOMATED PASS', { username: snap.username, uuid: snap.uuid, version: snap.minecraftVersion, position: snap.position, dimension: snap.dimension })
    if (snap.minecraftVersion !== config.version) throw new Error(`Expected Minecraft ${config.version}; got ${snap.minecraftVersion}`)
    let backendKnown = true
    if (command === 'whereami' || command === 'test smoke') {
      const backend = await client.queryBackend(state)
      backendKnown = Boolean(backend.backend)
      addStep(report, 'backend_identity', backend.backend ? 'AUTOMATED PASS' : 'NOT TESTED', backend)
    }
    if (command === 'inventory' || command === 'test smoke') addStep(report, 'inventory_snapshot', 'AUTOMATED PASS', snap.inventory)
    if (command === 'test smoke') {
      const movement = await client.moveBriefly(state)
      addStep(report, 'brief_movement', movement.moved ? 'AUTOMATED PASS' : 'AUTOMATED FAIL', movement)
      if (!movement.moved) throw new Error('Player position did not change during bounded movement')
    }
    if (command === 'whereami') addStep(report, 'player_state', 'AUTOMATED PASS', snap)
    finish(report, backendKnown ? 'AUTOMATED PASS' : 'NOT TESTED', await client.disconnect(state))
  } catch (error) {
    addStep(report, 'failure', 'AUTOMATED FAIL', { message: String(error.message).slice(0, 500), events: state?.events || [] })
    finish(report, 'AUTOMATED FAIL', await client.disconnect(state))
  }
  const paths = save(report)
  console.log(JSON.stringify({ ...report, report_files: paths }, null, 2))
  if (report.result !== 'AUTOMATED PASS' || report.cleanup !== 'PASS') process.exitCode = 1
}

async function main () {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry-run')
  const command = args.filter(a => a !== '--dry-run').join(' ')
  if (!command || command === 'help') return console.log(usage)
  if (command === 'status') return console.log(JSON.stringify(status(), null, 2))
  if (command === 'test local-smoke') {
    if (config.target !== 'local-lab') throw new Error('test local-smoke requires the isolated local-lab target')
    const { runLocalSmoke } = require('../scripts/local-lab')
    return runLocalSmoke({ dryRun: dry })
  }
  if (command === 'report latest') return console.log(JSON.stringify(latest(), null, 2))
  if (args[0] === 'cleanup' && args.length === 2) return console.log(JSON.stringify(cleanup(args[1]), null, 2))
  if (!['connect', 'whereami', 'inventory', 'test smoke'].includes(command)) throw new Error(`Unknown or unavailable command: ${command}. Run help.`)
  if (dry) return console.log(JSON.stringify({ command, target: config.target, endpoint: `${config.host}:${config.port}`, version: config.version,
    authentication: config.auth, planned: [config.auth === 'microsoft' ? 'Authenticate with licensed Java account' : 'Use isolated offline local identity', 'Join through selected Velocity endpoint', 'Observe client state', ...(command === 'test smoke' ? ['Move forward for 700 ms', 'Query /server'] : []), 'Disconnect'], productionChanges: [] }, null, 2))
  await run(command)
}

main().catch(error => { console.error(String(error.message).slice(0, 500)); process.exitCode = 1 })
