import {
    getPosition,
    getBiomeName,
    getNearbyPlayerNames,
    getInventoryCounts,
    getNearbyEntityTypes,
    getBlockAtPosition,
    getFirstBlockAboveHead
} from "./world.js";
import convoManager from "../conversation.js";

function makeSlot(item, index) {
    return {
        slot: index,
        name: item ? item.name : null,
        count: item ? item.count : 0
    };
}

function getInventoryView(bot) {
    const hotbar = [];
    for (let i = 36; i <= 44; i++) {
        hotbar.push(makeSlot(bot.inventory?.slots?.[i], i));
    }

    const mainInventory = [];
    for (let i = 9; i <= 35; i++) {
        mainInventory.push(makeSlot(bot.inventory?.slots?.[i], i));
    }

    return {
        counts: getInventoryCounts(bot),
        stacksUsed: bot.inventory?.items?.().length ?? 0,
        totalSlots: bot.inventory?.slots?.length ?? 0,
        selectedHotbarSlot: bot.quickBarSlot ?? 0,
        hotbar,
        mainInventory,
        offhand: makeSlot(bot.inventory?.slots?.[45], 45),
        equipment: {
            helmet: bot.inventory?.slots?.[5]?.name ?? null,
            chestplate: bot.inventory?.slots?.[6]?.name ?? null,
            leggings: bot.inventory?.slots?.[7]?.name ?? null,
            boots: bot.inventory?.slots?.[8]?.name ?? null,
            mainHand: bot.heldItem ? bot.heldItem.name : null
        }
    };
}

export function getFullState(agent) {
    const bot = agent.bot;

    if (!bot || !bot.entity || !bot.game || !bot.time || !bot.inventory) {
        return {
            name: agent?.name ?? "unknown",
            error: "Bot state not ready yet"
        };
    }

    const pos = getPosition(bot);

    const position = {
        x: Number(pos.x.toFixed(2)),
        y: Number(pos.y.toFixed(2)),
        z: Number(pos.z.toFixed(2))
    };

    let weather = "Clear";
    if (bot.thunderState > 0) weather = "Thunderstorm";
    else if (bot.rainState > 0) weather = "Rain";

    let timeLabel = "Night";
    if (bot.time.timeOfDay < 6000) timeLabel = "Morning";
    else if (bot.time.timeOfDay < 12000) timeLabel = "Afternoon";

    const below = getBlockAtPosition(bot, 0, -1, 0)?.name ?? "unknown";
    const legs = getBlockAtPosition(bot, 0, 0, 0)?.name ?? "unknown";
    const head = getBlockAtPosition(bot, 0, 1, 0)?.name ?? "unknown";

    let players = getNearbyPlayerNames(bot);
    const bots = convoManager.getInGameAgents().filter((b) => b !== agent.name);
    players = players.filter((p) => !bots.includes(p));

    return {
        name: agent.name,

        gameplay: {
            position,
            dimension: bot.game.dimension,
            gamemode: bot.game.gameMode,
            health: Math.round(bot.health),
            healthMax: 20,
            hunger: Math.round(bot.food),
            hungerMax: 20,
            biome: getBiomeName(bot),
            weather,
            timeOfDay: bot.time.timeOfDay,
            timeLabel
        },

        action: {
            current: agent.isIdle() ? "Idle" : agent.actions.currentActionLabel,
            isIdle: agent.isIdle()
        },

        surroundings: {
            below,
            legs,
            head,
            firstBlockAboveHead: getFirstBlockAboveHead(bot, null, 32)
        },

        inventory: getInventoryView(bot),

        nearby: {
            humanPlayers: players,
            botPlayers: bots,
            entityTypes: getNearbyEntityTypes(bot).filter(
                (t) => t !== "player" && t !== "item"
            )
        },

        modes: {
            summary: bot.modes.getMiniDocs()
        }
    };
}