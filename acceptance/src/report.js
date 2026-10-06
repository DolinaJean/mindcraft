'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const config = require('./config')

function newReport (test) {
  const now = new Date()
  return { run_id: `${now.toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`,
    started_at: now.toISOString(), minecraft_version: config.version, test,
    player_uuid: null, steps: [], result: 'NOT TESTED', cleanup: 'NOT TESTED' }
}

function addStep (report, name, result, evidence = {}) {
  report.steps.push({ at: new Date().toISOString(), name, result, evidence })
}

function finish (report, result, cleanup) {
  report.finished_at = new Date().toISOString()
  report.result = result
  report.cleanup = cleanup
  return report
}

function markdown (report) {
  const rows = report.steps.map(s => `| ${s.name} | ${s.result} | ${JSON.stringify(s.evidence).replace(/\|/g, '\\|').slice(0, 500)} |`).join('\n')
  return `# Minecraft Acceptance Bot run ${report.run_id}\n\n- Test: ${report.test}\n- Result: ${report.result}\n- Cleanup: ${report.cleanup}\n- Started: ${report.started_at}\n- Finished: ${report.finished_at || 'in progress'}\n- Player UUID: ${report.player_uuid || 'unknown'}\n\n| Step | Result | Evidence |\n|---|---|---|\n${rows}\n`
}

function save (report, folder = config.reportsFolder) {
  fs.mkdirSync(folder, { recursive: true })
  const json = path.join(folder, `${report.run_id}.json`)
  const md = path.join(folder, `${report.run_id}.md`)
  fs.writeFileSync(json, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  fs.writeFileSync(md, markdown(report), { flag: 'wx' })
  return { json, md }
}

module.exports = { newReport, addStep, finish, save, markdown }
