'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { inventorySnapshot, compareInventory, playerSnapshot } = require('../src/snapshot')

test('inventory snapshot retains slots, counts, and custom identity', () => {
  const bot = { inventory: { slots: Array(46).fill(null) }, quickBarSlot: 1 }
  bot.inventory.slots[37] = { name: 'paper', displayName: 'Ticket', count: 3, type: 100, metadata: 0, customName: 'run-123' }
  const inventory = inventorySnapshot(bot)
  assert.equal(inventory.heldSlot, 37)
  assert.equal(inventory.hotbar[0].customName, 'run-123')
  assert.equal(inventory.slots[0].count, 3)
})

test('comparison detects missing, extra, and count changes by item identity', () => {
  const item = (name, count, customName = null) => ({ name, type: 1, metadata: 0, customName, count })
  const expected = { slots: [item('paper', 2, 'run-a'), item('stone', 1)] }
  const actual = { slots: [item('paper', 1, 'run-a'), item('paper', 1, 'run-b'), item('dirt', 4)] }
  const result = compareInventory(expected, actual)
  assert.equal(result.equal, false)
  assert.equal(result.differences.length, 4)
  assert.deepEqual(result.differences.map(d => [d.expectedCount, d.actualCount]), [[2, 1], [1, 0], [0, 1], [0, 4]])
})

test('player state does not invent backend from coordinates', () => {
  const bot = { username: 'test', version: '26.2', entity: { position: { x: 1, y: 64, z: 2 }, yaw: 0, pitch: 0 }, game: { dimension: 'minecraft:overworld', gameMode: 'survival' }, inventory: { slots: [] } }
  const state = playerSnapshot(bot)
  assert.equal(state.position.y, 64)
  assert.equal(state.backend, undefined)
})
