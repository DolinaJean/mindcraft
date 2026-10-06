'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

function configFor (target) {
  const result = spawnSync(process.execPath, ['-e', "const c=require('./src/config');console.log(JSON.stringify({target:c.target,host:c.host,port:c.port,auth:c.auth}))"],
    { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, MC_ACCEPTANCE_TARGET: target }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('offline identity is confined to the loopback lab', () => {
  assert.deepEqual(configFor('local-lab'), { target: 'local-lab', host: '127.0.0.1', port: 25590, auth: 'offline' })
})

test('public production target still requires Microsoft authentication', () => {
  assert.deepEqual(configFor('production'), { target: 'production', host: 'portal.hanksfirewood.com', port: 25565, auth: 'microsoft' })
})
