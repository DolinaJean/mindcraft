'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { newReport, addStep, finish, save } = require('../src/report')

test('unique run IDs, failure state, and JSON/Markdown report match', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-acceptance-test-'))
  try {
    const report = newReport('test smoke')
    assert.notEqual(report.run_id, newReport('test smoke').run_id)
    addStep(report, 'login', 'AUTOMATED FAIL', { message: 'timed out' })
    finish(report, 'AUTOMATED FAIL', 'PASS')
    const paths = save(report, folder)
    const read = JSON.parse(fs.readFileSync(paths.json, 'utf8'))
    assert.equal(read.result, 'AUTOMATED FAIL')
    assert.equal(read.cleanup, 'PASS')
    assert.match(fs.readFileSync(paths.md, 'utf8'), /timed out/)
    assert.throws(() => save(report, folder), /EEXIST/)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
