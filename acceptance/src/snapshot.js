'use strict'

function plainItem (item, slot) {
  if (!item) return null
  const components = item.components == null ? null : JSON.parse(JSON.stringify(item.components, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
  return {
    slot,
    name: item.name || null,
    displayName: item.displayName || null,
    count: item.count ?? null,
    type: item.type ?? null,
    metadata: item.metadata ?? null,
    customName: item.customName ?? null,
    // Components are structured client evidence. Keep them bounded in reports.
    components
  }
}

function inventorySnapshot (bot) {
  const slots = (bot.inventory?.slots || []).map((item, slot) => plainItem(item, slot)).filter(Boolean)
  const heldSlot = bot.quickBarSlot == null ? null : 36 + bot.quickBarSlot
  return { slots, selectedHotbarSlot: bot.quickBarSlot ?? null, heldSlot,
    hotbar: slots.filter(item => item.slot >= 36 && item.slot <= 44),
    armorAndOffhand: slots.filter(item => item.slot >= 5 && item.slot <= 8 || item.slot === 45) }
}

function playerSnapshot (bot) {
  const position = bot.entity?.position
  const profile = bot._client?.session?.selectedProfile
  return {
    username: bot.username || bot._client?.username || null,
    uuid: profile?.id || bot._client?.uuid || null,
    minecraftVersion: bot.version || null,
    dimension: bot.game?.dimension || null,
    gameMode: bot.game?.gameMode || null,
    position: position ? { x: position.x, y: position.y, z: position.z, yaw: bot.entity.yaw, pitch: bot.entity.pitch } : null,
    health: bot.health ?? null,
    food: bot.food ?? null,
    experience: bot.experience ? { level: bot.experience.level, points: bot.experience.points, progress: bot.experience.progress } : null,
    inventory: inventorySnapshot(bot)
  }
}

function itemKey (item) {
  return JSON.stringify([item.name, item.type, item.metadata, item.customName, item.components])
}

function compareInventory (expected, actual) {
  const totals = items => {
    const map = new Map()
    for (const item of items.slots || []) map.set(itemKey(item), (map.get(itemKey(item)) || 0) + item.count)
    return map
  }
  const a = totals(expected)
  const b = totals(actual)
  const differences = []
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const expectedCount = a.get(key) || 0
    const actualCount = b.get(key) || 0
    if (expectedCount !== actualCount) differences.push({ identity: JSON.parse(key), expectedCount, actualCount })
  }
  return { equal: differences.length === 0, differences }
}

module.exports = { plainItem, inventorySnapshot, playerSnapshot, compareInventory }
