// ./src/agent/library/skills.js

import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import { Vec3 } from "vec3";
import settings from "../../../settings.js";
import baritonePkg from "@miner-org/mineflayer-baritone";

const { goals } = baritonePkg;

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;

export function log(bot, message) {
    bot.output += message + '\n';
}

export function getCarryInventoryStats(bot) {
    /**
     * Count only real carrying slots:
     * - hotbar (9)
     * - main inventory (27)
     * Ignore armor, offhand, and 2x2 crafting slots.
     */
    const slots = bot.inventory?.slots || [];

    // Main carry slots in Mineflayer player inventory:
    // 9-35 = main inventory (27)
    // 36-44 = hotbar (9)
    const carrySlots = [];
    for (let i = 9; i <= 44; i++) {
        carrySlots.push(slots[i] || null);
    }

    const used = carrySlots.filter(Boolean).length;
    const total = carrySlots.length;
    const free = total - used;

    return { used, free, total };
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

export const ensureItemDoc = `
Ensure the bot has at least the requested amount of an item.
May craft items or gather supported raw materials.
Returns: boolean
Example:
await skills.ensureItem(bot, "diamond", 24);
`;
export async function ensureItem(bot, itemName, amount = 1) {
    /**
     * Ensure the bot has at least `amount` of the given item.
     * Supports:
     * - inventory check
     * - direct crafting when possible
     * - simple resource gathering for common raw materials
     *
     * @param {MinecraftBot} bot
     * @param {string} itemName
     * @param {number} amount
     * @returns {Promise<boolean>}
     * @example
     * await skills.ensureItem(bot, "diamond", 24);
     */
    itemName = String(itemName || '').toLowerCase().trim();
    amount = Math.max(1, Number(amount) || 1);

    const countItem = (name) => {
        const counts = world.getInventoryCounts(bot);
        return counts[name] || 0;
    };

    if (countItem(itemName) >= amount) {
        log(bot, `Already have enough ${itemName}.`);
        return true;
    }

	// Special handling FIRST for raw materials that cannot be crafted
	if (itemName === 'diamond') {
		return await ensureDiamonds(bot, amount);
	}

	// Then try crafting for normal items
	try {
		const missing = amount - countItem(itemName);
		if (missing > 0) {
			const crafted = await craftRecipe(bot, itemName, missing);
			if (crafted && countItem(itemName) >= amount) {
				log(bot, `Crafted enough ${itemName}.`);
				return true;
			}
		}
	} catch (err) {
		log(bot, `Could not craft ${itemName}: ${err.message}`);
	}

    log(bot, `Could not ensure ${amount} ${itemName}. No gathering logic exists yet.`);
    return false;
}

export const ensureDiamondsDoc = `
Gather diamonds by moving to diamond depth and mining nearby visible ore while exploring underground.
Arguments: bot, amount=24
Returns: boolean
Example:
await skills.ensureDiamonds(bot, 24);
`;
export async function ensureDiamonds(bot, amount = 24) {
    /**
     * Gather diamonds by strip mining at diamond level.
     * Also opportunistically collects other useful exposed ores along the way.
     */

    amount = Math.max(1, Number(amount) || 1);

    const getCount = (name) => {
        const counts = world.getInventoryCounts(bot);
        return counts[name] || 0;
    };

    const getDiamondCount = () => getCount('diamond');

    const hasValidPickaxe = bot.inventory.items().some(item =>
        ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(item.name)
    );

    if (!hasValidPickaxe) {
        log(bot, 'Need at least an iron_pickaxe to mine diamond ore.');
        return false;
    }

    const carryStats = getCarryInventoryStats(bot);
    if (carryStats.free < 4) {
        log(bot, 'Inventory is too full for mining. Trying to stash items in a chest...');
        await stashInventoryInNearbyChest(bot);
    }

    const targetY = -55;

    if (bot.entity.position.y > targetY + 2 || bot.entity.position.y < targetY - 6) {
        log(bot, `Moving to diamond depth (Y=${targetY})...`);
        const pos = bot.entity.position;

        try {
            await goToPosition(bot, pos.x, targetY, pos.z, 2);
        } catch (err) {
            log(bot, `Failed to reach diamond depth: ${err.message}`);
            return false;
        }
    }

    let current = getDiamondCount();
    if (current >= amount) {
        log(bot, `Already have ${current} diamonds.`);
        return true;
    }

    const priorityOres = [
        'diamond_ore',
        'deepslate_diamond_ore',

        'redstone_ore',
        'deepslate_redstone_ore',
        'lapis_ore',
        'deepslate_lapis_ore',
        'gold_ore',
        'deepslate_gold_ore',
        'iron_ore',
        'deepslate_iron_ore',
        'emerald_ore',
        'deepslate_emerald_ore',
        'coal_ore',
        'deepslate_coal_ore',
        'copper_ore',
        'deepslate_copper_ore'
    ];

    let stripAttempts = 0;
    const maxStripAttempts = 12;
    const stripLength = 12;

    while (!bot.interrupt_code && current < amount && stripAttempts < maxStripAttempts) {
        if (bot.interrupt_code) {
            log(bot, 'Diamond gathering interrupted.');
            return false;
        }

        let minedAnything = false;

        // Step 1: collect any visible useful ore nearby
        for (const oreType of priorityOres) {
            if (bot.interrupt_code) return false;

            const beforeDiamonds = getDiamondCount();
            const success = await collectBlock(bot, oreType, 1);

            if (success) {
                minedAnything = true;
                await wait(bot, 400);

                current = getDiamondCount();
                if (current > beforeDiamonds) {
                    log(bot, `Collected diamonds: ${current}/${amount}.`);
                } else {
                    log(bot, `Collected ${oreType}.`);
                }

                if (current >= amount) {
                    log(bot, `Have enough diamonds: ${current}/${amount}.`);
                    return true;
                }

                const statsNow = getCarryInventoryStats(bot);
                if (statsNow.free < 4) {
                    log(bot, 'Inventory getting full. Trying to stash items...');
                    await stashInventoryInNearbyChest(bot);
                }
            }
        }

        // Step 2: if nothing visible, strip mine to reveal more blocks
        if (!minedAnything) {
            stripAttempts++;

            const pos = bot.entity.position;
            const direction = stripAttempts % 4;

            let targetX = Math.floor(pos.x);
            let targetZ = Math.floor(pos.z);

            if (direction === 0) targetX += stripLength;
            if (direction === 1) targetZ += stripLength;
            if (direction === 2) targetX -= stripLength;
            if (direction === 3) targetZ -= stripLength;

            log(bot, `No nearby ore found. Strip mining to new position (${stripAttempts}/${maxStripAttempts})...`);

            try {
                if (bot.interrupt_code) return false;
                await goToPosition(bot, targetX, targetY, targetZ, 2);
            } catch (err) {
                log(bot, `Strip-mine movement failed: ${err.message}`);
                await wait(bot, 1000);
            }
        } else {
            stripAttempts = 0;
        }

        current = getDiamondCount();
    }

    if (current >= amount) {
        return true;
    }

    log(bot, `Need ${amount} diamonds, but only have ${current}. Strip mining did not reveal enough ore.`);
    return false;
}

export async function equipHighestAttack(bot) {
    /**
     * Equip the best available combat weapon.
     * Prefers swords, then axes, then pickaxes, then shovels.
     */
    const priority = [
        'netherite_sword',
        'diamond_sword',
        'iron_sword',
        'stone_sword',
        'golden_sword',
        'wooden_sword',

        'netherite_axe',
        'diamond_axe',
        'iron_axe',
        'stone_axe',
        'golden_axe',
        'wooden_axe',

        'netherite_pickaxe',
        'diamond_pickaxe',
        'iron_pickaxe',
        'stone_pickaxe',
        'golden_pickaxe',
        'wooden_pickaxe',

        'netherite_shovel',
        'diamond_shovel',
        'iron_shovel',
        'stone_shovel',
        'golden_shovel',
        'wooden_shovel'
    ];

    const items = bot.inventory.items();

    for (const itemName of priority) {
        const item = items.find(i => i.name === itemName);
        if (item) {
            await bot.equip(item, 'hand');
            log(bot, `Equipped ${itemName} for combat.`);
            return true;
        }
    }

    log(bot, 'No usable combat weapon found. Fighting with whatever is in hand.');
    return false;
}

function isFoodItemName(name) {
    return [
        "bread", "cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken",
        "cooked_rabbit", "baked_potato", "carrot", "potato", "apple", "beetroot",
        "melon_slice", "pumpkin_pie", "cookie", "golden_carrot", "dried_kelp",
        "cooked_cod", "cooked_salmon"
    ].includes(name);
}

function isToolOrArmorName(name) {
    if (!name) return false;
    return (
        name.includes("_pickaxe") ||
        name.includes("_axe") ||
        name.includes("_shovel") ||
        name.includes("_hoe") ||
        name.includes("_sword") ||
        name.includes("_helmet") ||
        name.includes("_chestplate") ||
        name.includes("_leggings") ||
        name.includes("_boots") ||
        name === "shield" ||
        name === "elytra" ||
        name === "bow" ||
        name === "crossbow" ||
        name === "trident" ||
        name === "fishing_rod" ||
        name === "flint_and_steel" ||
        name === "shears"
    );
}

function isBuildingBlockName(name) {
    if (!name) return false;
    return (
        name.includes("planks") ||
        name.includes("log") ||
        name.includes("wood") ||
        name.includes("stone") ||
        name.includes("cobblestone") ||
        name.includes("deepslate") ||
        name.includes("dirt") ||
        name.includes("sand") ||
        name.includes("gravel") ||
        name.includes("glass") ||
        name.includes("terracotta") ||
        name.includes("concrete") ||
        name.includes("bricks") ||
        name.includes("slab") ||
        name.includes("stairs") ||
        name.includes("fence") ||
        name.includes("gate")
    );
}

function isOreOrValuableName(name) {
    return [
        "raw_iron", "raw_gold", "raw_copper",
        "iron_ingot", "gold_ingot", "copper_ingot", "netherite_scrap",
        "coal", "charcoal",
        "diamond", "emerald", "lapis_lazuli", "redstone", "quartz", "amethyst_shard",
        "iron_nugget", "gold_nugget"
    ].includes(name);
}

function isCropOrMobDropName(name) {
    return [
        "wheat", "wheat_seeds", "beetroot", "beetroot_seeds", "carrot", "potato",
        "pumpkin", "pumpkin_seeds", "melon", "melon_seeds", "sugar_cane", "bamboo",
        "leather", "feather", "string", "bone", "gunpowder", "spider_eye",
        "slime_ball", "rotten_flesh", "ender_pearl"
    ].includes(name);
}

function shouldKeepItemOnHand(name, count = 1) {
    if (!name) return true;
    if (isToolOrArmorName(name)) return true;
    if (name === "torch" || name === "bed" || name === "crafting_table" || name === "furnace" || name === "chest") return true;
    if (isFoodItemName(name)) return true;
    if (isBuildingBlockName(name) && count <= 64) return true;
    return false;
}

function shouldStoreItem(name, count = 1) {
    if (!name) return false;
    if (shouldKeepItemOnHand(name, count)) return false;
    if (isOreOrValuableName(name)) return true;
    if (isCropOrMobDropName(name)) return true;
    if (name.includes("_ingot") || name.includes("_nugget")) return true;
    if (name.includes("_ore")) return true;
    if (name.includes("book") || name.includes("paper") || name.includes("bottle")) return true;
    if (name.includes("rail") || name.includes("redstone")) return true;
    if (name.includes("wool")) return true;
    if (name.includes("dye")) return true;
    return count > 64;
}

function getNearbyOreNames() {
    return [
        "coal_ore", "deepslate_coal_ore",
        "iron_ore", "deepslate_iron_ore",
        "copper_ore", "deepslate_copper_ore",
        "gold_ore", "deepslate_gold_ore",
        "lapis_ore", "deepslate_lapis_ore",
        "redstone_ore", "deepslate_redstone_ore",
        "diamond_ore", "deepslate_diamond_ore",
        "emerald_ore", "deepslate_emerald_ore",
        "nether_quartz_ore", "nether_gold_ore"
    ];
}

function isAirLike(block) {
    return !block || block.name === "air" || block.name === "cave_air" || block.name === "void_air";
}

function isNaturalGroundName(name) {
    return [
        "grass_block",
        "dirt",
        "coarse_dirt",
        "podzol",
        "mycelium",
        "stone",
        "andesite",
        "diorite",
        "granite",
        "deepslate",
        "cobbled_deepslate",
        "sand",
        "red_sand",
        "gravel",
        "clay",
        "snow_block",
        "mud",
        "moss_block",
        "netherrack",
        "end_stone"
    ].includes(name);
}

function getHorizontalNeighbors(bot, pos) {
    return [
        bot.blockAt(pos.offset( 1, 0,  0)),
        bot.blockAt(pos.offset(-1, 0,  0)),
        bot.blockAt(pos.offset( 0, 0,  1)),
        bot.blockAt(pos.offset( 0, 0, -1))
    ];
}

function countSolidNeighbors(bot, pos) {
    return getHorizontalNeighbors(bot, pos).filter(b => b && !isAirLike(b)).length;
}

function looksLikeTowerBlock(bot, block) {
    if (!block || isAirLike(block)) return false;
    if (!block.diggable) return false;

    const pos = block.position;
    const above = bot.blockAt(pos.offset(0, 1, 0));
    const below = bot.blockAt(pos.offset(0, -1, 0));
    const horizontalSolid = countSolidNeighbors(bot, pos);
    const horizontalAir = 4 - horizontalSolid;

    // Strong signal: narrow exposed support
    if (horizontalAir >= 3) return true;

    // Dirt / random blocks can still be part of a tower if they are exposed and stacked
    if (horizontalAir >= 2 && below && !isAirLike(below)) return true;

    // If above is air and this block is kind of isolated, also likely support
    if (isAirLike(above) && horizontalAir >= 2) return true;

    return false;
}

function looksLikeNaturalSurface(bot, supportBlock) {
    if (!supportBlock || isAirLike(supportBlock)) return false;

    const pos = supportBlock.position;
    const horizontalSolid = countSolidNeighbors(bot, pos);

    // Broad connected ground is likely surface
    if (isNaturalGroundName(supportBlock.name) && horizontalSolid >= 2) {
        return true;
    }

    // If there is a lot of surrounding terrain, treat as ground
    if (horizontalSolid >= 3) {
        return true;
    }

    return false;
}

function findNearbyTowerSupport(bot) {
    const feet = bot.entity.position.floored();

    // Search around current feet for a crooked / offset tower
    const candidates = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const support = bot.blockAt(feet.offset(dx, -1, dz));
            const headSpace1 = bot.blockAt(feet.offset(dx, 0, dz));
            const headSpace2 = bot.blockAt(feet.offset(dx, 1, dz));

            if (!support) continue;
            if (!isAirLike(headSpace1)) continue;
            if (!isAirLike(headSpace2)) continue;
            if (!looksLikeTowerBlock(bot, support)) continue;

            candidates.push(support);
        }
    }

    if (candidates.length === 0) return null;

    // Prefer the support closest to the bot horizontally
    candidates.sort((a, b) => {
        const da = bot.entity.position.distanceTo(a.position.offset(0.5, 1, 0.5));
        const db = bot.entity.position.distanceTo(b.position.offset(0.5, 1, 0.5));
        return da - db;
    });

    return candidates[0];
}

async function waitForDrop(bot, oldY, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (bot.entity.position.y < oldY - 0.2) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
}

function hasSafeLandingBelow(bot, supportBlock) {
    if (!supportBlock) return false;

    // If we break the support block, this is where we should land
    const landingBlock = bot.blockAt(supportBlock.position.offset(0, -1, 0));
    if (!landingBlock || isAirLike(landingBlock)) {
        return false;
    }

    // Need enough air space for the bot above the landing block
    const bodySpace = bot.blockAt(landingBlock.position.offset(0, 1, 0));
    const headSpace = bot.blockAt(landingBlock.position.offset(0, 2, 0));

    if (!isAirLike(bodySpace)) return false;
    if (!isAirLike(headSpace)) return false;

    return true;
}

/**
 * Descend from a crooked player-made tower by breaking support blocks beneath the bot.
 * This is designed for messy towers made of mixed materials and not perfectly vertical.
 * The bot will try to follow nearby support blocks downward and stop when broad natural-looking ground is reached.
 * It only breaks a support block if there is a safe landing block immediately below it.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @param {number} maxSteps, maximum number of descent steps before stopping.
 * @returns {Promise<boolean>} true if the bot descends successfully or stops safely, false if interrupted.
 * @example
 * await skills.descendTower(bot, 80);
 */
export async function descendTower(bot, maxSteps = 80) {
    if (!bot || !bot.entity) {
        throw new Error("Bot not ready");
    }

    if (bot.ashfinder?.stop) bot.ashfinder.stop();
    if (bot.baritone?.stop) bot.baritone.stop();
    bot.clearControlStates();

    for (let step = 0; step < maxSteps; step++) {
        if (bot.interrupt_code) return false;

        const feet = bot.entity.position.floored();
        let support = bot.blockAt(feet.offset(0, -1, 0));

        if (looksLikeNaturalSurface(bot, support)) {
            log(bot, `Stopped descending at y=${Math.floor(bot.entity.position.y)} on ${support?.name || "unknown"}.`);
            return true;
        }

        if (!looksLikeTowerBlock(bot, support)) {
            const nearbySupport = findNearbyTowerSupport(bot);

            if (!nearbySupport) {
                log(bot, "Could not find more tower blocks nearby.");
                return true;
            }

            const standX = nearbySupport.position.x + 0.5;
            const standY = nearbySupport.position.y + 1;
            const standZ = nearbySupport.position.z + 0.5;

            await goToPosition(bot, standX, standY, standZ, 0.6);

            support = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
            if (!looksLikeTowerBlock(bot, support)) {
                log(bot, "Reached nearby block, but it does not look like tower support.");
                return true;
            }
        }

        // SAFETY CHECK: do not break if it would cause a huge fall
        if (!hasSafeLandingBelow(bot, support)) {
            log(bot, `Unsafe to break ${support.name} at ${support.position.x}, ${support.position.y}, ${support.position.z}; no safe landing below.`);
            return true;
        }

        const oldY = bot.entity.position.y;

        try {
            bot.setControlState("sneak", true);
            await bot.dig(support, true);
        } finally {
            bot.setControlState("sneak", false);
        }

        const dropped = await waitForDrop(bot, oldY, 2000);
        if (!dropped) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        // Extra safety: if somehow we dropped too far, stop immediately
        if (oldY - bot.entity.position.y > 2.5) {
            log(bot, "Dropped too far unexpectedly. Stopping tower descent.");
            return true;
        }
    }

    log(bot, "Stopped descending after reaching maxSteps.");
    return true;
}

function normalizeCraftName(itemName) {
    const name = String(itemName || '').toLowerCase().trim();

    const aliases = {
        bed: 'white_bed',
        table: 'crafting_table',
        workbench: 'crafting_table',
        planks: 'oak_planks',
        logs: 'oak_log',
        log: 'oak_log'
    };

    return aliases[name] || name;
}

export async function craftRecipe(bot, itemName, num = 1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot - Reference to the minecraft bot.
     * @param {string} itemName - The item name to craft.
     * @param {number} num - Number of times to craft.
     * @returns {Promise<boolean>} true if at least one craft succeeded, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick", 1);
     */

    itemName = normalizeCraftName(itemName);
    num = Math.max(1, Number(num) || 1);

    let placedTable = false;
    let craftingTable = null;

    try {
        const allRecipes = mc.getItemCraftingRecipes(itemName);
        if (!allRecipes || allRecipes.length === 0) {
            log(bot, `${itemName} is either not a valid item, or it does not have a crafting recipe.`);
            return false;
        }

        const itemId = mc.getItemId(itemName);
        if (itemId == null) {
            log(bot, `Could not resolve item id for ${itemName}.`);
            return false;
        }

        // First try recipes that do not require a crafting table.
        let recipes = bot.recipesFor(itemId, null, 1, null);

        const craftingTableRange = 16;

        if (!recipes || recipes.length === 0) {
            // Try recipes that require a crafting table.
            recipes = bot.recipesFor(itemId, null, 1, true);

            if (!recipes || recipes.length === 0) {
                log(bot, `You do not have the resources to craft ${itemName}.`);
                return false;
            }

            // Look for a nearby crafting table first.
            craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);

            if (!craftingTable) {
                const invCounts = world.getInventoryCounts(bot);
                const hasTable = (invCounts['crafting_table'] || 0) > 0;

                if (!hasTable) {
                    log(bot, `Crafting ${itemName} requires a crafting table, and none is nearby or in inventory.`);
                    return false;
                }

                const pos = world.getNearestFreeSpace(bot, 1, 6);
                if (!pos) {
                    log(bot, `Crafting ${itemName} requires a crafting table, but there is no safe free space to place one.`);
                    return false;
                }

                await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
                craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);

                if (!craftingTable) {
                    log(bot, `Failed to place a crafting table for crafting ${itemName}.`);
                    return false;
                }

                placedTable = true;
            }

            if (bot.entity.position.distanceTo(craftingTable.position) > 4) {
                await goToNearestBlock(bot, 'crafting_table', 4, craftingTableRange);
            }

            recipes = bot.recipesFor(itemId, null, 1, craftingTable);
        }

        if (!recipes || recipes.length === 0) {
            log(bot, `You do not have the resources to craft ${itemName}.`);
            return false;
        }

        const recipe = recipes[0];
        const inventory = world.getInventoryCounts(bot);
        const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe);
        const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);

        const craftCount = Math.min(craftLimit.num || 0, num);
        if (craftCount <= 0) {
            const limiting = craftLimit?.limitingResource ? ` Missing: ${craftLimit.limitingResource}.` : '';
            log(bot, `You do not have the resources to craft ${itemName}.${limiting}`);
            return false;
        }

        console.log(`crafting ${itemName} x${craftCount}...`);
        await bot.craft(recipe, craftCount, craftingTable);

        const newCount = world.getInventoryCounts(bot)[itemName] || 0;
        if (craftCount < num) {
            log(bot, `Not enough materials to craft ${num} ${itemName}. Crafted ${craftCount}. You now have ${newCount} ${itemName}.`);
        } else {
            log(bot, `Successfully crafted ${craftCount} ${itemName}. You now have ${newCount} ${itemName}.`);
        }

        if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') {
            await bot.armorManager.equipAll();
        }

        return true;
    } catch (err) {
        log(bot, `Failed to craft ${itemName}: ${err.message}`);
        throw err;
    } finally {
        if (placedTable) {
            try {
                await collectBlock(bot, 'crafting_table', 1);
            } catch (cleanupErr) {
                log(bot, `Could not pick up placed crafting_table after crafting: ${cleanupErr.message}`);
            }
        }
    }
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num = 1) {
    /**
     * Smelts the given item name using a nearby or placed furnace.
     * @param {MinecraftBot} bot
     * @param {string} itemName
     * @param {number} num
     * @returns {Promise<boolean>}
     */

    itemName = String(itemName || '').toLowerCase().trim();
    num = Math.max(1, Number(num) || 1);

    if (!mc.isSmeltable(itemName)) {
        log(bot, `Cannot smelt ${itemName}. Hint: use the raw or cookable item name.`);
        return false;
    }

    let placedFurnace = false;
    let furnaceBlock = null;
    let furnace = null;
    const furnaceRange = 16;

    try {
        furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);

        if (!furnaceBlock) {
            const invCounts = world.getInventoryCounts(bot);
            const hasFurnace = (invCounts['furnace'] || 0) > 0;

            if (!hasFurnace) {
                log(bot, `There is no furnace nearby and you do not have one in inventory.`);
                return false;
            }

            const pos = world.getNearestFreeSpace(bot, 1, furnaceRange);
            if (!pos) {
                log(bot, `There is no safe free space nearby to place a furnace.`);
                return false;
            }

            await placeBlock(bot, 'furnace', pos.x, pos.y, pos.z);

            furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
            if (!furnaceBlock) {
                log(bot, `Failed to place a furnace.`);
                return false;
            }

            placedFurnace = true;
        }

        if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
            await goToNearestBlock(bot, 'furnace', 4, furnaceRange);
        }

        if (bot.modes && typeof bot.modes.pause === 'function') {
            bot.modes.pause('unstuck');
        }

        await bot.lookAt(furnaceBlock.position);
        console.log(`smelting ${itemName} x${num}...`);

        furnace = await bot.openFurnace(furnaceBlock);

        // Check if furnace is already occupied with a different input
        const inputItem = furnace.inputItem();
        if (inputItem && inputItem.type !== mc.getItemId(itemName) && inputItem.count > 0) {
            log(bot, `The furnace is currently smelting ${mc.getItemName(inputItem.type)}.`);
            return false;
        }

        // Check inventory count
        const invCounts = world.getInventoryCounts(bot);
        if (!invCounts[itemName] || invCounts[itemName] < num) {
            log(bot, `You do not have enough ${itemName} to smelt.`);
            return false;
        }

        // Fuel furnace if needed
        if (!furnace.fuelItem()) {
            const fuel = mc.getSmeltingFuel(bot);
            if (!fuel) {
                log(bot, `You have no usable fuel to smelt ${itemName}.`);
                return false;
            }

            const perFuel = mc.getFuelSmeltOutput(fuel.name);
            if (!perFuel || perFuel <= 0) {
                log(bot, `Could not determine smelting output for fuel ${fuel.name}.`);
                return false;
            }

            const putFuel = Math.ceil(num / perFuel);

            if ((fuel.count || 0) < putFuel) {
                log(bot, `You do not have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${putFuel}.`);
                return false;
            }

            log(bot, `Using ${fuel.name} as fuel.`);
            await furnace.putFuel(fuel.type, null, putFuel);
            log(bot, `Added ${putFuel} ${mc.getItemName(fuel.type)} to furnace fuel.`);
        }

        // Put input items into furnace
        await furnace.putInput(mc.getItemId(itemName), null, num);

        // Wait for output
        let total = 0;
        let smeltedItem = null;
        let lastCollected = Date.now();

        await new Promise(resolve => setTimeout(resolve, 200));

        while (total < num) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const out = furnace.outputItem();
            if (out) {
                smeltedItem = await furnace.takeOutput();
                if (smeltedItem) {
                    total += smeltedItem.count;
                    lastCollected = Date.now();
                }
            }

            if (Date.now() - lastCollected > 11000) {
                break;
            }

            if (bot.interrupt_code) {
                break;
            }
        }

        // Return leftovers if present
        if (furnace.inputItem()) {
            await furnace.takeInput();
        }
        if (furnace.fuelItem()) {
            await furnace.takeFuel();
        }

        if (total === 0) {
            log(bot, `Failed to smelt ${itemName}.`);
            return false;
        }

        const outName = smeltedItem ? mc.getItemName(smeltedItem.type) : 'items';

        if (total < num) {
            log(bot, `Only smelted ${total} ${outName}.`);
            return false;
        }

        log(bot, `Successfully smelted ${itemName}, got ${total} ${outName}.`);
        return true;
    } catch (err) {
        log(bot, `Failed to smelt ${itemName}: ${err.message}`);
        throw err;
    } finally {
        try {
            if (furnace) {
                await bot.closeWindow(furnace);
            }
        } catch {}

        if (placedFurnace) {
            try {
                await collectBlock(bot, 'furnace', 1);
            } catch (cleanupErr) {
                log(bot, `Could not pick up placed furnace: ${cleanupErr.message}`);
            }
        }
    }
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot
     * @returns {Promise<boolean>}
     */

    let furnace = null;

    try {
        const furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
        if (!furnaceBlock) {
            log(bot, `No furnace nearby to clear.`);
            return false;
        }

        if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
            await goToNearestBlock(bot, 'furnace', 4, 32);
        }

        console.log('clearing furnace...');
        furnace = await bot.openFurnace(furnaceBlock);

        let smeltedItem = null;
        let inputItem = null;
        let fuelItem = null;

        if (furnace.outputItem()) {
            smeltedItem = await furnace.takeOutput();
        }
        if (furnace.inputItem()) {
            inputItem = await furnace.takeInput();
        }
        if (furnace.fuelItem()) {
            fuelItem = await furnace.takeFuel();
        }

        const smeltedName = smeltedItem ? `${smeltedItem.count} ${smeltedItem.name}` : `0 smelted items`;
        const inputName = inputItem ? `${inputItem.count} ${inputItem.name}` : `0 input items`;
        const fuelName = fuelItem ? `${fuelItem.count} ${fuelItem.name}` : `0 fuel items`;

        log(bot, `Cleared furnace, received ${smeltedName}, ${inputName}, and ${fuelName}.`);
        return true;
    } catch (err) {
        log(bot, `Failed to clear furnace: ${err.message}`);
        throw err;
    } finally {
        try {
            if (furnace) {
                await bot.closeWindow(furnace);
            }
        } catch {}
    }
}

function isCombatTargetAlive(bot, entity, range = 32) {
    if (!bot || !entity || entity.id == null) return false;

    const refreshed = Object.values(bot.entities).find(e => e && e.id === entity.id);
    if (!refreshed || !refreshed.position) return false;

    return bot.entity.position.distanceTo(refreshed.position) <= range;
}

function getEntityById(bot, entityId) {
    if (!bot || entityId == null) return null;
    return Object.values(bot.entities).find(e => e && e.id === entityId) || null;
}

function isHostileCombatMob(entity) {
    if (!entity || !entity.name || !entity.position) return false;

    const hostile = new Set([
        "zombie",
        "husk",
        "drowned",
        "skeleton",
        "stray",
        "creeper",
        "spider",
        "cave_spider",
        "enderman",
        "witch",
        "pillager",
        "vindicator",
        "evoker",
        "phantom",
        "slime",
        "magma_cube",
        "blaze",
        "ghast",
        "hoglin",
        "zoglin",
        "piglin_brute",
        "zombified_piglin",
        "piglin",
        "guardian",
        "elder_guardian",
        "endermite",
        "shulker",
        "warden"
    ]);

    return hostile.has(entity.name);
}

function getNearestHostileCombatTarget(bot, range = 16) {
    if (!bot?.entity?.position) return null;

    let best = null;
    let bestScore = Infinity;

    for (const entity of Object.values(bot.entities)) {
        if (!isHostileCombatMob(entity)) continue;

        const dist = bot.entity.position.distanceTo(entity.position);
        if (dist > range) continue;

        // prioritize dangerous close threats
        let score = dist;

        if (entity.name === "creeper") score -= 2.5;
        if (entity.name === "phantom") score -= 1.5;
        if (entity.name === "skeleton") score -= 1.0;

        if (score < bestScore) {
            best = entity;
            bestScore = score;
        }
    }

    return best;
}

async function stopCombat(bot) {
    if (!bot) return;

    try {
        if (bot.pvp?.stop) bot.pvp.stop();
    } catch {}

    try {
        if (bot.ashfinder?.stop) bot.ashfinder.stop();
    } catch {}

    try {
        if (bot.baritone?.stop) bot.baritone.stop();
    } catch {}

    bot.clearControlStates();
    bot._currentDefendTarget = null;
}

async function defendAgainstPhantom(bot, phantom) {
    if (!bot || !phantom || !phantom.position) return false;

    bot._currentDefendTarget = phantom.id;

    try {
        await equipHighestAttack(bot);

        // Phantoms are better handled manually than with generic pvp chase
        if (bot.pvp?.stop) bot.pvp.stop();
        if (bot.ashfinder?.stop) bot.ashfinder.stop();
        if (bot.baritone?.stop) bot.baritone.stop();

        const started = Date.now();
        const maxFightMs = 30000;

        while (isCombatTargetAlive(bot, phantom, 40)) {
            if (bot.interrupt_code) {
                await stopCombat(bot);
                return false;
            }

            if (Date.now() - started > maxFightMs) {
                log(bot, `Stopped fighting phantom after timeout.`);
                await stopCombat(bot);
                return false;
            }

            const current = getEntityById(bot, phantom.id);
            if (!current || !current.position) break;

            const pos = current.position;
            const dist = bot.entity.position.distanceTo(pos);
            const verticalGap = pos.y - bot.entity.position.y;

            try {
                await bot.lookAt(pos.offset(0, current.height || 0.5, 0), true);
            } catch {}

            // only swing when the phantom is actually in reach
            if (dist <= 4.5 && verticalGap <= 3.2) {
                try {
                    await bot.attack(current);
                } catch {}
            }

            bot.clearControlStates();
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        bot._currentDefendTarget = null;
        log(bot, `Successfully fought off phantom.`);
        await pickupNearbyItems(bot);
        return true;
    } finally {
        bot._currentDefendTarget = null;
    }
}

async function defendAgainstCreeper(bot, creeper) {
    if (!bot || !creeper || !creeper.position) return false;

    bot._currentDefendTarget = creeper.id;

    try {
        await equipHighestAttack(bot);

        const started = Date.now();
        const maxFightMs = 15000;

        while (isCombatTargetAlive(bot, creeper, 24)) {
            if (bot.interrupt_code) {
                await stopCombat(bot);
                return false;
            }

            if (Date.now() - started > maxFightMs) {
                log(bot, `Stopped fighting creeper after timeout.`);
                await stopCombat(bot);
                return false;
            }

            const current = getEntityById(bot, creeper.id);
            if (!current || !current.position) break;

            const dist = bot.entity.position.distanceTo(current.position);

            // keep distance from creepers; do not hug them
            if (dist < 3.5) {
                try {
                    await moveAway(bot, 4);
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 250));
                continue;
            }

            if (bot.pvp?.attack) {
                try {
                    bot.pvp.attack(current);
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }

            try {
                await goToPosition(bot, current.position.x, current.position.y, current.position.z, 4);
                await bot.lookAt(current.position, true);
                if (bot.entity.position.distanceTo(current.position) <= 4.2) {
                    await bot.attack(current);
                }
            } catch {}

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        bot._currentDefendTarget = null;
        await pickupNearbyItems(bot);
        return true;
    } finally {
        bot._currentDefendTarget = null;
    }
}

export async function attackNearest(bot, mobType, kill = true) {
    /**
     * Attack nearest mob of the given type.
     */
    bot.modes.pause("cowardice");

    if (
        mobType === "drowned" ||
        mobType === "cod" ||
        mobType === "salmon" ||
        mobType === "tropical_fish" ||
        mobType === "squid"
    ) {
        bot.modes.pause("self_preservation");
    }

    const mob = world.getNearbyEntities(bot, 24).find(entity => entity && entity.name === mobType);
    if (!mob) {
        log(bot, `Could not find any ${mobType} to attack.`);
        return false;
    }

    return await attackEntity(bot, mob, kill);
}

export async function attackEntity(bot, entity, kill = true) {
    /**
     * Attack a specific entity.
     */
    if (!bot || !entity || !entity.position) return false;

    await equipHighestAttack(bot);

    // special cases first
    if (entity.name === "phantom") {
        return await defendAgainstPhantom(bot, entity);
    }

    if (entity.name === "creeper") {
        return await defendAgainstCreeper(bot, entity);
    }

    bot._currentDefendTarget = entity.id;

    try {
        // single hit only
        if (!kill) {
            const current = getEntityById(bot, entity.id) || entity;

            if (bot.entity.position.distanceTo(current.position) > 5) {
                await goToPosition(bot, current.position.x, current.position.y, current.position.z, 4);
            }

            await bot.lookAt(current.position, true);
            await bot.attack(current);
            return true;
        }

        // standard kill logic for ground hostiles
        if (bot.pvp?.attack) {
            bot.pvp.attack(entity);

            const started = Date.now();
            const maxFightMs = 20000;

            while (isCombatTargetAlive(bot, entity, 32)) {
                await new Promise(resolve => setTimeout(resolve, 500));

                if (bot.interrupt_code) {
                    await stopCombat(bot);
                    return false;
                }

                if (Date.now() - started > maxFightMs) {
                    log(bot, `Stopped fighting ${entity.name} after timeout.`);
                    await stopCombat(bot);
                    return false;
                }
            }

            bot._currentDefendTarget = null;
            log(bot, `Successfully killed ${entity.name}.`);
            await pickupNearbyItems(bot);
            return true;
        }

        // fallback melee if pvp plugin is unavailable
        const started = Date.now();
        const maxFightMs = 20000;

        while (isCombatTargetAlive(bot, entity, 32)) {
            if (bot.interrupt_code) {
                bot._currentDefendTarget = null;
                return false;
            }

            if (Date.now() - started > maxFightMs) {
                log(bot, `Stopped fighting ${entity.name} after timeout.`);
                bot._currentDefendTarget = null;
                return false;
            }

            const current = getEntityById(bot, entity.id);
            if (!current || !current.position) break;

            const pos = current.position;
            if (bot.entity.position.distanceTo(pos) > 4) {
                await goToPosition(bot, pos.x, pos.y, pos.z, 4);
            }

            try {
                await bot.lookAt(pos.offset(0, current.height || 0.8, 0), true);
                if (bot.entity.position.distanceTo(pos) <= 4.2) {
                    await bot.attack(current);
                }
            } catch {}

            await new Promise(resolve => setTimeout(resolve, 700));
        }

        bot._currentDefendTarget = null;
        log(bot, `Successfully killed ${entity.name}.`);
        await pickupNearbyItems(bot);
        return true;
    } finally {
        bot._currentDefendTarget = null;
    }
}

// Backward-compatible alias for older code
// Backward-compatible alias for older code
export async function self_defense(bot, targetName) {
    if (!targetName) {
        return await defendSelf(bot, 8);
    }

    const player = bot.players[targetName]?.entity;
    if (!player) return false;

    await equipHighestAttack(bot);

    if (bot.pvp?.attack) {
        bot.pvp.attack(player);
        return true;
    }

    const pos = player.position;
    if (bot.entity.position.distanceTo(pos) > 4) {
        await goToPosition(bot, pos.x, pos.y, pos.z, 4);
    }

    await bot.lookAt(pos, true);
    await bot.attack(player);
    return true;
}

/**
 * Defend against nearby hostile mobs.
 * Uses existing attackEntity logic so combat behavior stays consistent.
 * @param {MinecraftBot} bot
 * @param {number} range
 * @returns {Promise<boolean>}
 */
export async function defendSelf(bot, range = 8) {
    if (!bot || !bot.entity) return false;

    // If already defending something, do not restart combat over and over
    if (bot._currentDefendTarget) return true;

    const nearby = getNearestHostileCombatTarget(bot, range);
    if (!nearby) return false;

    return await attackEntity(bot, nearby, true);
}

/**
 * Collect the nearest blocks of a given type by walking to them and digging them.
 * Simple Ashfinder-safe version.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @param {string} blockType, the block type to collect.
 * @param {number} num, the number of blocks to collect.
 * @returns {Promise<boolean>} true if at least one block was collected, false otherwise.
 * @example
 * await skills.collectBlock(bot, "oak_planks", 24);
 */
export async function collectBlock(bot, blockType, num = 1) {
    if (!bot || !bot.entity) {
        throw new Error("Bot not ready");
    }

    const mcData = bot.registry || bot.mcData;
    const blockId = mcData?.blocksByName?.[blockType]?.id;

    if (!blockId) {
        log(bot, `Unknown block type: ${blockType}`);
        return false;
    }

    let collected = 0;

    for (let i = 0; i < num; i++) {
        if (bot.interrupt_code) return false;

        const target = bot.findBlock({
            matching: blockId,
            maxDistance: 64
        });

        if (!target) {
            if (collected === 0) {
                log(bot, `Could not find any ${blockType} nearby.`);
                return false;
            }
            break;
        }

        await goToPosition(
            bot,
            target.position.x,
            target.position.y,
            target.position.z,
            3
        );

        const block = bot.blockAt(target.position);
        if (!block || block.name !== blockType) {
            continue;
        }

        try {
            await bot.dig(block, true);
            collected++;
        } catch (err) {
            log(bot, `Failed to dig ${blockType}: ${err.message}`);
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    log(bot, `Collected ${collected} ${blockType}.`);
    return collected > 0;
}

export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.z);
     **/
    if (x == null || y == null || z == null) {
        throw new Error('Invalid position to break block at.');
    }

    const blockPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const block = bot.blockAt(blockPos);

    if (!block) {
        log(bot, `Could not inspect block at x:${x}, y:${y}, z:${z}.`);
        return false;
    }

    if (block.name === 'air' || block.name === 'water' || block.name === 'lava') {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }

    if (bot.modes.isOn('cheat')) {
        if (useDelay) {
            await new Promise(resolve => setTimeout(resolve, blockPlaceDelay));
        }
        const msg = `/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} air`;
        bot.chat(msg);
        log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
        return true;
    }

    // Move close enough using the new unified movement helper
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        await goToPosition(bot, block.position.x, block.position.y, block.position.z, 4);
    }

    if (bot.game.gameMode !== 'creative') {
        try {
            await bot.tool.equipForBlock(block);
        } catch (err) {
            log(bot, `Could not equip a tool for ${block.name}: ${err.message}`);
            return false;
        }

        const itemId = bot.heldItem ? bot.heldItem.type : null;
        if (!block.canHarvest(itemId)) {
            log(bot, `Don't have the right tools to break ${block.name}.`);
            return false;
        }
    }

    try {
        await bot.dig(block, true);
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
        return true;
    } catch (err) {
        log(bot, `Failed to break ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
        console.log(err);
        return false;
    }
}

export async function placeBlock(bot, blockType, x, y, z, placeOn = 'bottom', dontCheat = false) {
    /**
     * Place the given block type at the given position.
     * It will build off from any adjacent blocks.
     * Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place, which can be a block or item name.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on.
     * Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'.
     * Defaults to bottom.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.z);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.z, "side");
     **/
    const targetDest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${targetDest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            const block = bot.inventory.findInventoryItem(blockType);
            if (!block) {
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        let face =
            placeOn === 'north' ? 'south' :
            placeOn === 'south' ? 'north' :
            placeOn === 'east' ? 'west' :
            'east';

        if (blockType.includes('torch') && placeOn !== 'bottom') {
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }

        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            } else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            } else {
                blockType += `[facing=${face}]`;
            }
        }

        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }

        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }

        if (useDelay) {
            await new Promise(resolve => setTimeout(resolve, blockPlaceDelay));
        }

        bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${blockType}`);

        if (blockType.includes('door')) {
            if (useDelay) {
                await new Promise(resolve => setTimeout(resolve, blockPlaceDelay));
            }
            bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y + 1)} ${Math.floor(z)} ${blockType}[half=upper]`);
        }

        if (blockType.includes('bed')) {
            if (useDelay) {
                await new Promise(resolve => setTimeout(resolve, blockPlaceDelay));
            }
            bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z - 1)} ${blockType}[part=head]`);
        }

        log(bot, `Used /setblock to place ${blockType} at ${targetDest}.`);
        return true;
    }

    let itemName = blockType;
    if (itemName === 'redstone_wire') {
        itemName = 'redstone';
    } else if (itemName === 'water') {
        itemName = 'water_bucket';
    } else if (itemName === 'lava') {
        itemName = 'lava_bucket';
    }

    let blockItem = bot.inventory.findInventoryItem(itemName);
    if (!blockItem && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(itemName, 1));
        blockItem = bot.inventory.findInventoryItem(itemName);
    }

    if (!blockItem) {
        log(bot, `Don't have any ${itemName} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(targetDest);
    if (!targetBlock) {
        log(bot, `Could not inspect target block at ${targetDest}.`);
        return false;
    }

    if (targetBlock.name === blockType || (targetBlock.name === 'grass_block' && blockType === 'dirt')) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }

    const emptyBlocks = [
        'air', 'water', 'lava', 'grass', 'short_grass',
        'tall_grass', 'snow', 'dead_bush', 'fern'
    ];

    if (!emptyBlocks.includes(targetBlock.name)) {
        log(bot, `${targetBlock.name} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    let buildOffBlock = null;
    let faceVec = null;

    const dirMap = {
        top: new Vec3(0, 1, 0),
        bottom: new Vec3(0, -1, 0),
        north: new Vec3(0, 0, -1),
        south: new Vec3(0, 0, 1),
        east: new Vec3(1, 0, 0),
        west: new Vec3(-1, 0, 0)
    };

    const dirs = [];
    if (placeOn === 'side') {
        dirs.push(dirMap.north, dirMap.south, dirMap.east, dirMap.west);
    } else if (dirMap[placeOn] !== undefined) {
        dirs.push(dirMap[placeOn]);
    } else {
        dirs.push(dirMap.bottom);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }

    dirs.push(...Object.values(dirMap).filter(d => !dirs.includes(d)));

    for (const d of dirs) {
        const adjacent = bot.blockAt(targetDest.plus(d));
        if (adjacent && !emptyBlocks.includes(adjacent.name)) {
            buildOffBlock = adjacent;
            faceVec = new Vec3(-d.x, -d.y, -d.z);
            break;
        }
    }

    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const posAbove = pos.plus(new Vec3(0, 1, 0));
    const dontMoveFor = [
        'torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail',
        'detector_rail', 'powered_rail', 'activator_rail', 'tripwire_hook',
        'tripwire', 'water_bucket', 'string'
    ];

    if (
        !dontMoveFor.includes(itemName) &&
        (pos.distanceTo(targetBlock.position) < 1.1 || posAbove.distanceTo(targetBlock.position) < 1.1)
    ) {
        await moveAway(bot, 2);
    }

    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        const p = targetBlock.position;
        await goToPosition(bot, p.x, p.y, p.z, 3);
    }

    try {
        if (itemName.includes('bucket')) {
            await useToolOnBlock(bot, itemName, buildOffBlock);
            log(bot, `Placed ${blockType} at ${targetDest}.`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return true;
        } else {
            await bot.equip(blockItem, 'hand');
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5), true);
            await bot.placeBlock(buildOffBlock, faceVec);
            log(bot, `Placed ${blockType} at ${targetDest}.`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return true;
        }
    } catch (err) {
        log(bot, `Failed to place ${blockType} at ${targetDest}.`);
        console.log(err);
        return false;
    }
}

export async function equip(bot, itemName) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    if (itemName === 'hand') {
        await bot.unequip('hand');
        log(bot, `Unequipped hand.`);
        return true;
    }
    let item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
    if (!item) {
        if (bot.game.gameMode === "creative") {
            await bot.creative.setInventorySlot(36, mc.makeItem(itemName, 1));
            item = bot.inventory.findInventoryItem(itemName);
        }
        else {
            log(bot, `You do not have any ${itemName} to equip.`);
            return false;
        }
    }
    if (itemName.includes('leggings')) {
        await bot.equip(item, 'legs');
    }
    else if (itemName.includes('boots')) {
        await bot.equip(item, 'feet');
    }
    else if (itemName.includes('helmet')) {
        await bot.equip(item, 'head');
    }
    else if (itemName.includes('chestplate') || itemName.includes('elytra')) {
        await bot.equip(item, 'torso');
    }
    else if (itemName.includes('shield')) {
        await bot.equip(item, 'off-hand');
    }
    else {
        await bot.equip(item, 'hand');
    }
    log(bot, `Equipped ${itemName}.`);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = bot.inventory.findInventoryItem(itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

export async function putInChest(bot, itemName, num = -1) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot
     * @param {string} itemName
     * @param {number} num - number to store; -1 means all
     * @returns {Promise<boolean>}
     */

    itemName = String(itemName || '').toLowerCase().trim();
    num = Number(num);
    if (Number.isNaN(num)) num = -1;

    let chestContainer = null;

    try {
        const chest = world.getNearestBlock(bot, 'chest', 32);
        if (!chest) {
            log(bot, `Could not find a chest nearby.`);
            return false;
        }

        const item = bot.inventory.findInventoryItem(itemName);
        if (!item) {
            log(bot, `You do not have any ${itemName} to put in the chest.`);
            return false;
        }

        const toPut = num === -1 ? item.count : Math.max(0, Math.min(num, item.count));
        if (toPut <= 0) {
            log(bot, `Nothing to put in the chest for ${itemName}.`);
            return false;
        }

        await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
        chestContainer = await bot.openContainer(chest);

        try {
            await chestContainer.deposit(item.type, null, toPut);
        } catch (err) {
            if (String(err.message || err).toLowerCase().includes('destination full')) {
                log(bot, `Chest is full. Could not store ${toPut} ${itemName}.`);
                return false;
            }
            throw err;
        }

        log(bot, `Successfully put ${toPut} ${itemName} in the chest.`);
        return true;
    } catch (err) {
        log(bot, `Failed to put ${itemName} in chest: ${err.message}`);
        throw err;
    } finally {
        try {
            if (chestContainer) {
                await chestContainer.close();
            }
        } catch {}
    }
}

export async function takeFromChest(bot, itemName, num = -1) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot
     * @param {string} itemName
     * @param {number} num - number to take; -1 means all
     * @returns {Promise<boolean>}
     */

    itemName = String(itemName || '').toLowerCase().trim();
    num = Number(num);
    if (Number.isNaN(num)) num = -1;

    let chestContainer = null;

    try {
        const chest = world.getNearestBlock(bot, 'chest', 32);
        if (!chest) {
            log(bot, `Could not find a chest nearby.`);
            return false;
        }

        await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
        chestContainer = await bot.openContainer(chest);

        const matchingItems = chestContainer
            .containerItems()
            .filter(item => item && item.name === itemName);

        if (matchingItems.length === 0) {
            log(bot, `Could not find any ${itemName} in the chest.`);
            return false;
        }

        const totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
        let remaining = num === -1 ? totalAvailable : Math.max(0, Math.min(num, totalAvailable));
        let totalTaken = 0;

        if (remaining <= 0) {
            log(bot, `Nothing to take from the chest for ${itemName}.`);
            return false;
        }

        for (const item of matchingItems) {
            if (remaining <= 0) break;

            const toTakeFromSlot = Math.min(remaining, item.count);
            await chestContainer.withdraw(item.type, null, toTakeFromSlot);

            totalTaken += toTakeFromSlot;
            remaining -= toTakeFromSlot;
        }

        if (totalTaken <= 0) {
            log(bot, `Failed to take any ${itemName} from the chest.`);
            return false;
        }

        log(bot, `Successfully took ${totalTaken} ${itemName} from the chest.`);
        return true;
    } catch (err) {
        log(bot, `Failed to take ${itemName} from chest: ${err.message}`);
        throw err;
    } finally {
        try {
            if (chestContainer) {
                await chestContainer.close();
            }
        } catch {}
    }
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot
     * @returns {Promise<boolean>}
     */

    let chestContainer = null;

    try {
        const chest = world.getNearestBlock(bot, 'chest', 32);
        if (!chest) {
            log(bot, `Could not find a chest nearby.`);
            return false;
        }

        await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
        chestContainer = await bot.openContainer(chest);

        const items = chestContainer.containerItems();

        if (!items || items.length === 0) {
            log(bot, `The chest is empty.`);
            return true;
        }

        log(bot, `The chest contains:`);
        for (const item of items) {
            log(bot, `${item.count} ${item.name}`);
        }

        return true;
    } catch (err) {
        log(bot, `Failed to view chest: ${err.message}`);
        throw err;
    } finally {
        try {
            if (chestContainer) {
                await chestContainer.close();
            }
        } catch {}
    }
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (itemName) {
        item = bot.inventory.findInventoryItem(itemName);
        name = itemName;
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    await bot.equip(item, 'hand');
    await bot.consume();
    log(bot, `Consumed ${item.name}.`);
    return true;
}

export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    if (bot.username === username) {
        log(bot, `You cannot give items to yourself.`);
        return false;
    }
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username, 3);
    // if we are 2 below the player
    log(bot, bot.entity.position.y, player.position.y);
    if (bot.entity.position.y < player.position.y - 1) {
        await goToPlayer(bot, username, 1);
    }
    // if we are too close, make some distance
    if (bot.entity.position.distanceTo(player.position) < 2) {
        let too_close = true;
        let start_moving_away = Date.now();
        await moveAwayFromEntity(bot, player, 2);
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            too_close = bot.entity.position.distanceTo(player.position) < 5;
            if (too_close) {
                await moveAwayFromEntity(bot, player, 5);
            }
            if (Date.now() - start_moving_away > 3000) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}, too close.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    if (await discard(bot, itemType, num)) {
        let given = false;
        bot.once('playerCollect', (collector, collected) => {
            console.log(collected.name);
            if (collector.username === username) {
                log(bot, `${username} received ${itemType}.`);
                given = true;
            }
        });
        let start = Date.now();
        while (!given && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (given) {
                return true;
            }
            if (Date.now() - start > 3000) {
                break;
            }
        }
    }
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}

export async function moveTo(bot, x, y, z, distance = 2) {
    return await goToPosition(bot, x, y, z, distance);
}

let _doorInterval = null;
function startDoorInterval(bot) {
    /**
     * Start helper interval that opens nearby doors if the bot is stuck.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {number} the interval id.
     **/
    if (_doorInterval) {
        clearInterval(_doorInterval);
    }
    let prev_pos = bot.entity.position.clone();
    let prev_check = Date.now();
    let stuck_time = 0;


    const doorCheckInterval = setInterval(() => {
        const now = Date.now();
        if (bot.entity.position.distanceTo(prev_pos) >= 0.1) {
            stuck_time = 0;
        } else {
            stuck_time += now - prev_check;
        }
        
        if (stuck_time > 1200) {
            // shuffle positions so we're not always opening the same door
            const positions = [
                bot.entity.position.clone(),
                bot.entity.position.offset(0, 0, 1),
                bot.entity.position.offset(0, 0, -1), 
                bot.entity.position.offset(1, 0, 0),
                bot.entity.position.offset(-1, 0, 0),
            ]
            let elevated_positions = positions.map(position => position.offset(0, 1, 0));
            positions.push(...elevated_positions);
            positions.push(bot.entity.position.offset(0, 2, 0)); // above head
            positions.push(bot.entity.position.offset(0, -1, 0)); // below feet
            
            let currentIndex = positions.length;
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;
                [positions[currentIndex], positions[randomIndex]] = [
                positions[randomIndex], positions[currentIndex]];
            }
            
            for (let position of positions) {
                let block = bot.blockAt(position);
                if (block && block.name &&
                    !block.name.includes('iron') &&
                    (block.name.includes('door') ||
                     block.name.includes('fence_gate') ||
                     block.name.includes('trapdoor'))) 
                {
                    bot.activateBlock(block);
                    break;
                }
            }
            stuck_time = 0;
        }
        prev_pos = bot.entity.position.clone();
        prev_check = now;
    }, 200);
    _doorInterval = doorCheckInterval;
    return doorCheckInterval;
}

/**
 * Find and go to the nearest block of a given type.
 * Returns false instead of throwing if none is found.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @param {string} blockType, the block type to go to.
 * @param {number} distance, how close to get.
 * @param {number} range, search radius.
 * @returns {Promise<boolean>} true if a block was found and approached, false otherwise.
 * @example
 * await skills.goToNearestBlock(bot, "sugar_cane", 2, 64);
 */
export async function goToNearestBlock(bot, blockType, distance = 2, range = 64) {
    if (!bot || !bot.entity) {
        throw new Error("Bot not ready");
    }

    const mcData = bot.registry || bot.mcData;
    const blockId = mcData?.blocksByName?.[blockType]?.id;

    if (!blockId) {
        log(bot, `Unknown block type: ${blockType}`);
        return false;
    }

    const target = bot.findBlock({
        matching: blockId,
        maxDistance: Number(range) || 64
    });

    if (!target) {
        log(bot, `No ${blockType} found within ${range} blocks.`);
        return false;
    }

    await goToPosition(
        bot,
        target.position.x,
        target.position.y,
        target.position.z,
        distance
    );

    return true;
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance} blocks away.`);
    await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('unstuck');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => {
            return block.name.includes('bed');
        },
        maxDistance: 32,
        count: 1
    });
    if (beds.length === 0) {
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    await bot.sleep(bed);
    log(bot, `You are in bed.`);
    bot.modes.pause('unstuck');
    while (bot.isSleeping) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    return true;
}

export const goToPositionDoc = `
Move near a target world position using Ashfinder.
Arguments: bot, x, y, z, distance=2
Returns: boolean
Example:
await skills.goToPosition(bot, 100, 64, -20, 2);
`;
export async function goToPosition(bot, x, y, z, distance = 2) {
    if (!bot || !bot.ashfinder || !bot.entity) {
        throw new Error("Ashfinder not initialized");
    }

    const base = new Vec3(
        Math.floor(x),
        Math.floor(y),
        Math.floor(z)
    );

    const minDistance = Math.max(distance, 2);

    const distTo = (pos) => bot.entity.position.distanceTo(pos);

    // If already close enough, do not path again.
    if (distTo(base) <= minDistance) {
        return true;
    }

    // Wider candidate set:
    // - target block
    // - horizontal adjacents
    // - diagonals
    // - one block above / below
    // This helps a lot around corners and awkward ledges.
    const offsets = [
        [0, 0, 0],

        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],

        [1, 0, 1],
        [1, 0, -1],
        [-1, 0, 1],
        [-1, 0, -1],

        [0, 1, 0],
        [0, -1, 0],

        [1, 1, 0],
        [-1, 1, 0],
        [0, 1, 1],
        [0, 1, -1],

        [1, -1, 0],
        [-1, -1, 0],
        [0, -1, 1],
        [0, -1, -1]
    ];

    const seen = new Set();
    const targets = offsets
        .map(([dx, dy, dz]) => new Vec3(base.x + dx, base.y + dy, base.z + dz))
        .filter((pos) => {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        // Try the most reachable-looking targets first.
        .sort((a, b) => distTo(a) - distTo(b));

    let lastErr = null;

    for (const target of targets) {
        try {
            // Skip any candidate already close enough.
            if (distTo(target) <= minDistance) {
                return true;
            }

            // Stop any stale path before retrying another goal.
            if (typeof bot.ashfinder.stop === "function") {
                bot.ashfinder.stop();
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const goal = new goals.GoalNear(target, minDistance);
            await bot.ashfinder.goto(goal);

            return true;
        } catch (err) {
            lastErr = err;
        }
    }

    if (lastErr) throw lastErr;
    return false;
}

export const goToSurfaceDoc = `
Move upward toward the surface using stepwise Ashfinder pathing.
Returns: boolean
Example:
await skills.goToSurface(bot);
`;
export async function goToSurface(bot) {
    /**
     * Move upward toward the surface using stepwise pathing.
     * Works with Ashfinder (no Baritone required).
     */

    if (!bot || !bot.ashfinder || !bot.entity) {
        throw new Error("Ashfinder not initialized");
    }

    let attempts = 0;
    const maxAttempts = 20;

    while (!bot.interrupt_code && attempts < maxAttempts) {
        const pos = bot.entity.position;

        // Check if we reached open air (surface-ish)
        const above = bot.blockAt(pos.offset(0, 1, 0));
        const above2 = bot.blockAt(pos.offset(0, 2, 0));

        if (
            above && above.name === 'air' &&
            above2 && above2.name === 'air' &&
            pos.y > 60 // avoid caves
        ) {
            log(bot, "Reached surface.");
            return true;
        }

        const targetY = pos.y + 5;

        try {
            await goToPosition(bot, pos.x, targetY, pos.z, 2);
        } catch (err) {
            log(bot, `Failed moving upward: ${err.message}`);
            return false;
        }

        await new Promise(r => setTimeout(r, 200));
        attempts++;
    }

    log(bot, "Could not reach surface.");
    return false;
}

export async function goTo(bot, x, y, z, distance = 2) {
    return await goToPosition(bot, x, y, z, distance);
}

export async function goToPlayer(bot, username, distance = 3) {
    if (bot.username === username) {
        log(bot, `You are already at ${username}.`);
        return true;
    }

    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');

    const player = bot.players[username]?.entity;
    if (!player || !player.position) {
        log(bot, `Could not find ${username}.`);
        return false;
    }

    await goToPosition(
        bot,
        player.position.x,
        player.position.y,
        player.position.z,
        Math.max(distance, 3)
    );

    log(bot, `You have reached ${username}.`);
    return true;
}

export async function follow(bot, username, followDistance = 3, durationMs = 15000) {
    const start = Date.now();

    while (!bot.interrupt_code && Date.now() - start < durationMs) {
        const target = bot.players[username]?.entity;
        if (!target || !target.position) {
            log(bot, "I lost sight of you.");
            return false;
        }

        const dist = bot.entity.position.distanceTo(target.position);
        if (dist > followDistance + 1) {
            await goToPosition(
                bot,
                target.position.x,
                target.position.y,
                target.position.z,
                followDistance
            );
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return true;
}

export async function followPlayer(bot, username, distance = 3) {
    return await follow(bot, username, distance);
}

export async function moveAway(bot, distance = 5) {
    if (!bot || !bot.entity || !bot.ashfinder) {
        throw new Error("Ashfinder not initialized");
    }

    const pos = bot.entity.position;
    const angle = Math.random() * Math.PI * 2;

    const targetX = pos.x + Math.cos(angle) * distance;
    const targetZ = pos.z + Math.sin(angle) * distance;
    const targetY = pos.y;

    const goal = new goals.GoalNear(
        new Vec3(
            Math.floor(targetX),
            Math.floor(targetY),
            Math.floor(targetZ)
        ),
        2
    );

    await bot.ashfinder.goto(goal);
    return true;
}

export async function moveAwayFromEntity(bot, entity, distance = 16) {
    if (!bot || !bot.entity || !entity || !entity.position) return false;

    const myPos = bot.entity.position;
    const enemyPos = entity.position;

    let dx = myPos.x - enemyPos.x;
    let dz = myPos.z - enemyPos.z;

    const mag = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= mag;
    dz /= mag;

    const targetX = myPos.x + dx * distance;
    const targetZ = myPos.z + dz * distance;

    await goToPosition(bot, targetX, myPos.y, targetZ, 3);
    return true;
}

export async function avoidEnemies(bot, distance = 16) {
    bot.modes.pause('self_preservation');

    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);

    while (enemy && !bot.interrupt_code) {
        await moveAwayFromEntity(bot, enemy, distance);

        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);

        if (enemy && bot.entity.position.distanceTo(enemy.position) < 3) {
            await attackEntity(bot, enemy, false);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function pickupNearbyItems(bot) {
    const distance = 8;

    const getNearestItem = () =>
        bot.nearestEntity(entity =>
            entity &&
            entity.name === "item" &&
            entity.position &&
            bot.entity.position.distanceTo(entity.position) < distance
        );

    let pickedUp = 0;
    let safetyCounter = 0;

    while (safetyCounter < 20) {
        safetyCounter++;

        if (bot.interrupt_code) return pickedUp > 0;

        const target = getNearestItem();
        if (!target) break;

        const targetId = target.id;

        try {
            await goToPosition(
                bot,
                target.position.x,
                target.position.y,
                target.position.z,
                2
            );
        } catch (err) {
            log(bot, `Could not reach dropped item: ${err.message}`);
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 400));

        const stillThere = Object.values(bot.entities).find(
            entity => entity && entity.id === targetId
        );

        if (!stillThere) {
            pickedUp++;
        } else {
            break;
        }
    }

    if (pickedUp > 0) {
        log(bot, `Picked up ${pickedUp} item stack(s).`);
    } else {
        log(bot, "No nearby items were actually picked up.");
    }

    return pickedUp > 0;
}

export async function useDoor(bot, door_pos = null) {
    if (!door_pos) {
        for (let door_type of [
            'oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door',
            'dark_oak_door', 'mangrove_door', 'cherry_door', 'bamboo_door',
            'crimson_door', 'warped_door'
        ]) {
            const found = world.getNearestBlock(bot, door_type, 16);
            if (found) {
                door_pos = found.position;
                break;
            }
        }
    } else {
        door_pos = new Vec3(door_pos.x, door_pos.y, door_pos.z);
    }

    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    await goToPosition(bot, door_pos.x, door_pos.y, door_pos.z, 2);

    const door_block = bot.blockAt(door_pos);
    if (!door_block) {
        log(bot, `Door block is missing.`);
        return false;
    }

    await bot.lookAt(door_pos);
    try {
        await bot.activateBlock(door_block);
    } catch {}

    bot.setControlState("forward", true);
    await new Promise(resolve => setTimeout(resolve, 600));
    bot.setControlState("forward", false);

    try {
        await bot.activateBlock(door_block);
    } catch {}

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    let pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    let block = bot.blockAt(pos);
    log(bot, `Planting ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);

    if (bot.modes.isOn('cheat')) {
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        placeBlock(bot, 'farmland', x, y, z);
        placeBlock(bot, seedType, x, y+1, z);
        return true;
    }

    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        if (block.name === 'farmland') {
            log(bot, `Land is already farmed with ${above.name}.`);
            return true;
        }
        let broken = await breakBlockAt(bot, x, y+1, z);
        if (!broken) {
            log(bot, `Cannot cannot break above block to till.`);
            return false;
        }
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
    let pos = block.position;
    await goToPosition(bot, pos.x, pos.y, pos.z, 4);
	}
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        let to_equip = hoe?.name || 'diamond_hoe';
        if (!await equip(bot, to_equip)) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let equipped_seeds = await equip(bot, seedType);
        if (!equipped_seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }

        await bot.activateBlock(block);
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
    let pos = block.position;
    await goToPosition(bot, pos.x, pos.y, pos.z, 4);
	}
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

async function findAndGoToVillager(bot, id) {
    id = id + "";
    const entity = bot.entities[id];

    if (!entity) {
        log(bot, `Cannot find villager with id ${id}`);
        let entities = world.getNearbyEntities(bot, 16);
        let villager_list = "Available villagers:\n";

        for (let entity of entities) {
            if (entity.name === 'villager') {
                if (entity.metadata && entity.metadata[16] === 1) {
                    villager_list += `${entity.id}: baby villager\n`;
                } else {
                    const profession = world.getVillagerProfession(entity);
                    villager_list += `${entity.id}: ${profession}\n`;
                }
            }
        }

        if (villager_list === "Available villagers:\n") {
            log(bot, "No villagers found nearby.");
            return null;
        }

        log(bot, villager_list);
        return null;
    }

    if (entity.entityType !== bot.registry.entitiesByName.villager.id) {
        log(bot, 'Entity is not a villager');
        return null;
    }

    if (entity.metadata && entity.metadata[16] === 1) {
        log(bot, 'This is either a baby villager or a villager with no job - neither can trade');
        return null;
    }

    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 4) {
        log(bot, `Villager is ${distance.toFixed(1)} blocks away, moving closer...`);
        try {
            bot.modes.pause('unstuck');
            await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, 2);
            log(bot, 'Successfully reached villager');
        } catch (err) {
            log(bot, 'Failed to reach villager - pathfinding error or villager moved');
            console.log(err);
            return null;
        } finally {
            bot.modes.unpause('unstuck');
        }
    }

    return entity;
}

/**
 * Show trades of a villager.
 * If villagerId is -1, uses the nearest villager.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @param {number} villagerId, villager entity id, or -1 for nearest villager.
 * @returns {Promise<boolean>} true if trades were shown, false otherwise.
 * @example
 * await skills.showVillagerTrades(bot, -1);
 */
export async function showVillagerTrades(bot, villagerId = -1) {
    if (!bot) {
        throw new Error("Bot not ready");
    }

    let villager = null;

    if (villagerId === -1) {
        const villagers = Object.values(bot.entities).filter(
            e => e && e.name === "villager" && e.position
        );

        if (villagers.length === 0) {
            log(bot, "No villager nearby.");
            return false;
        }

        villagers.sort((a, b) =>
            bot.entity.position.distanceTo(a.position) -
            bot.entity.position.distanceTo(b.position)
        );

        villager = villagers[0];
    } else {
        villager = Object.values(bot.entities).find(
            e => e && e.id === villagerId && e.name === "villager"
        );
    }

    if (!villager) {
        log(bot, `Could not find villager ${villagerId}.`);
        return false;
    }

    const dist = bot.entity.position.distanceTo(villager.position);
    if (dist > 4) {
        await goToPosition(bot, villager.position.x, villager.position.y, villager.position.z, 2);
    }

    let villagerWindow;
    try {
        villagerWindow = await bot.openVillager(villager);
    } catch (err) {
        log(bot, `Failed to open villager trades: ${err.message}`);
        return false;
    }

    const trades = villagerWindow.trades || [];
    if (!trades.length) {
        log(bot, "Villager has no visible trades.");
        villagerWindow.close();
        return false;
    }

    let msg = `Villager ${villager.id} trades:\n`;
    trades.forEach((trade, idx) => {
        const in1 = trade.inputItem1 ? `${trade.inputItem1.count} ${trade.inputItem1.name}` : "nothing";
        const in2 = trade.inputItem2 ? ` + ${trade.inputItem2.count} ${trade.inputItem2.name}` : "";
        const out = trade.outputItem ? `${trade.outputItem.count} ${trade.outputItem.name}` : "nothing";
        msg += `${idx + 1}. ${in1}${in2} -> ${out}\n`;
    });

    log(bot, msg.trim());
    villagerWindow.close();
    return true;
}

/**
 * Trade with a specified villager.
 * If id is -1, uses the nearest villager.
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to trade with, or -1 for nearest villager
 * @param {number} index - the index (1-based) of the trade to execute
 * @param {number} count - how many times to execute the trade
 * @returns {Promise<boolean>} true if trade was successful, false otherwise
 * @example
 * await skills.tradeWithVillager(bot, -1, 1, 2);
 */
export async function tradeWithVillager(bot, id = -1, index = 1, count = 1) {
    if (!bot || !bot.entity) {
        log(bot, "Bot is not ready.");
        return false;
    }

    let villagerEntity = null;

    // Use nearest villager if id is -1
    if (Number(id) === -1) {
        const villagers = Object.values(bot.entities).filter(
            e => e && e.name === "villager" && e.position
        );

        if (villagers.length === 0) {
            log(bot, "No villager nearby.");
            return false;
        }

        villagers.sort((a, b) =>
            bot.entity.position.distanceTo(a.position) -
            bot.entity.position.distanceTo(b.position)
        );

        villagerEntity = villagers[0];
    } else {
        villagerEntity = await findAndGoToVillager(bot, id);
        if (!villagerEntity) {
            return false;
        }
    }

    // Move close enough if needed
    const dist = bot.entity.position.distanceTo(villagerEntity.position);
    if (dist > 4) {
        await goToPosition(
            bot,
            villagerEntity.position.x,
            villagerEntity.position.y,
            villagerEntity.position.z,
            2
        );
    }

    try {
        const villager = await bot.openVillager(villagerEntity);

        if (!villager.trades || villager.trades.length === 0) {
            log(bot, "This villager has no trades available. It may be sleeping, a baby, or jobless.");
            villager.close();
            return false;
        }

        const tradeIndex = Number(index) - 1;
        const trade = villager.trades[tradeIndex];

        if (!trade) {
            log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades.`);
            villager.close();
            return false;
        }

        if (trade.disabled) {
            log(bot, `Trade ${index} is currently disabled.`);
            villager.close();
            return false;
        }

        const requestedCount = Number(count) || 1;
        const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const actualCount = Math.min(requestedCount, maxPossibleTrades);

        if (actualCount <= 0) {
            log(bot, `Trade ${index} has reached its maximum use limit.`);
            villager.close();
            return false;
        }

        const item2 = trade.inputItem2 ? `${stringifyItem(bot, trade.inputItem2)} ` : "";
        log(
            bot,
            `Trading ${stringifyItem(bot, trade.inputItem1)} ${item2}for ${stringifyItem(bot, trade.outputItem)}...`
        );

        if (!hasResources(bot.inventory.items(), trade, actualCount)) {
            log(bot, `Not enough resources to execute trade ${index} ${actualCount} time(s).`);
            villager.close();
            return false;
        }

        log(bot, `Executing trade ${index} ${actualCount} time(s)...`);

        try {
            await bot.trade(villager, tradeIndex, actualCount);
            log(bot, `Successfully traded ${actualCount} time(s).`);
            villager.close();
            return true;
        } catch (tradeErr) {
            log(bot, "An error occurred while trying to execute the trade.");
            console.log("Trade execution error:", tradeErr.message);
            villager.close();
            return false;
        }
    } catch (err) {
        log(bot, "Failed to open villager trading interface.");
        console.log("Villager interface error:", err.message);
        return false;
    }
}

function hasResources(window, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
        let c = 0;
        window.forEach((element) => {
            if (element && element.type === item.type && element.metadata === item.metadata) {
                c += element.count;
            }
        });
        return c >= item.count * count;
    }
}

function stringifyTrades(bot, trades) {
    return trades.map((trade) => {
        let text = stringifyItem(bot, trade.inputItem1);
        if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
        if (trade.disabled) text += ' x '; else text += ' » ';
        text += stringifyItem(bot, trade.outputItem);
        return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
    });
}

function stringifyItem(bot, item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
        const ench = item.nbt.value.ench;
        const StoredEnchantments = item.nbt.value.StoredEnchantments;
        const Potion = item.nbt.value.Potion;
        const display = item.nbt.value.display;

        if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
        if (display) text += ` named ${display.value.Name.value}`;
        if (ench || StoredEnchantments) {
            text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                const lvl = e.lvl.value;
                const id = e.id.value;
                return bot.registry.enchantments[id].displayName + ' ' + lvl;
            }).join(' ')}`;
        }
    }
    return text;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    let start_block_pos = bot.blockAt(bot.entity.position).position;
    for (let i = 1; i <= distance; i++) {
        const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
        let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

        if (!targetBlock || !belowBlock) {
            log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
            return true;
        }

        // Check for lava, water
        if (targetBlock.name === 'lava' || targetBlock.name === 'water' || 
            belowBlock.name === 'lava' || belowBlock.name === 'water') {
            log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
            return false;
        }

        const MAX_FALL_BLOCKS = 2;
        let num_fall_blocks = 0;
        for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
            if (!belowBlock || (belowBlock.name !== 'air' && belowBlock.name !== 'cave_air')) {
                break;
            }
            num_fall_blocks++;
            belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
        }
        if (num_fall_blocks > MAX_FALL_BLOCKS) {
            log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
            return false;
        }

        if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') {
            log(bot, 'Skipping air block');
            console.log(targetBlock.position);
            continue;
        }

        let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
        if (!dug) {
            log(bot, 'Failed to dig block at position:' + targetBlock.position);
            return false;
        }
    }
    log(bot, `Dug down ${distance} blocks.`);
    return true;
}

export async function useToolOn(bot, toolName, targetName) {
    /**
     * Equip a tool and use it on the nearest target.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {string} targetName - entity type, block type, or "nothing" for no target
     * @returns {Promise<boolean>} true if action succeeded
     */
    if (!bot.inventory.slots.find(slot => slot && slot.name === toolName) && !bot.game.gameMode === 'creative') {
        log(bot, `You do not have any ${toolName} to use.`);
        return false;
    }

    targetName = targetName.toLowerCase();
    if (targetName === 'nothing') {
        const equipped = await equip(bot, toolName);
        if (!equipped) {
            return false;
        }
        await bot.activateItem();
        log(bot, `Used ${toolName}.`);
    } else if (world.isEntityType(targetName)) {
        const entity = world.getNearestEntityWhere(bot, e => e.name === targetName, 64);
        if (!entity) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z);
        if (toolName === 'hand') {
            await bot.unequip('hand');
        }
        else {
            const equipped = await equip(bot, toolName);
            if (!equipped) return false;
        }
        await bot.useOn(entity);
        log(bot, `Used ${toolName} on ${targetName}.`);
    } else {
        let block = null;
        if (targetName === 'water' || targetName === 'lava') {
            // we want to get liquid source blocks, not flowing blocks
            // so search for blocks with metadata 0 (not flowing)
            let blocks = world.getNearestBlocksWhere(bot, block => block.name === targetName && block.metadata === 0, 64, 1);
            if (blocks.length === 0) {
                log(bot, `Could not find any source ${targetName}.`);
                return false;
            }
            block = blocks[0];
        }
        else {
            block = world.getNearestBlock(bot, targetName, 64);
        }
        if (!block) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        return await useToolOnBlock(bot, toolName, block);
    }

    return true;
 }

export async function useToolOnBlock(bot, toolName, block) {
    /**
     * Use a tool on a specific block.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {Block} block - the block reference to use the tool on.
     * @returns {Promise<boolean>} true if action succeeded
     */

    const distance = toolName === 'water_bucket' && block.name !== 'lava' ? 1.5 : 2;
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, distance);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

    // if block in view is closer than the target block, it is in our way. try to move closer
    const viewBlocked = () => {
        const blockInView = bot.blockAtCursor(5);
        const headPos = bot.entity.position.offset(0, bot.entity.height, 0);
        return blockInView && 
            !blockInView.position.equals(block.position) && 
            blockInView.position.distanceTo(headPos) < block.position.distanceTo(headPos);
    }
    const blockInView = bot.blockAtCursor(5);
    if (viewBlocked()) {
        log(bot, `Block ${blockInView.name} is in the way, moving closer...`);
        // choose random block next to target block, go to it
        const nearbyPos = block.position.offset(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        await goToPosition(bot, nearbyPos.x, nearbyPos.y, nearbyPos.z, 1);
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        if (viewBlocked()) {
            const blockInView = bot.blockAtCursor(5);
            log(bot, `Block ${blockInView.name} is in the way, not using ${toolName}.`);
            return false;
        }
    }

    const equipped = await equip(bot, toolName);

    if (!equipped) {
        log(bot, `Could not equip ${toolName}.`);
        return false;
    }
    if (toolName.includes('bucket')) {
        await bot.activateItem();
    }
    else {
        await bot.activateBlock(block);
    }
    log(bot, `Used ${toolName} on ${block.name}.`);
    return true;
 }

// -------- PRODUCTIVE IDLE LOOP -------- //

/**
 * Run one productive idle task.
 * Order: sleep -> smelt -> store -> make/place chest -> hunt -> visible ores.
 * Logs the decision it makes for easier debugging.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @returns {Promise<boolean>} true if any productive work was done, false otherwise.
 * @example
 * await skills.runProductiveIdle(bot);
 */
export async function runProductiveIdle(bot) {
    if (!bot || !bot.entity) {
        log(bot, "Productive idle: bot not ready.");
        return false;
    }

    // Safety checks
    if (bot.health < 10) {
        log(bot, "Productive idle: skipping because health is low.");
        return false;
    }

    if (bot.pvp?.target) {
        log(bot, "Productive idle: skipping because combat target exists.");
        return false;
    }

    try {
        log(bot, "Productive idle: checking sleep.");
        if (await sleepIfNeeded(bot)) {
            log(bot, "Productive idle: chose sleep.");
            return true;
        }

        log(bot, "Productive idle: checking smeltable ores.");
        if (await smeltInventoryOres(bot)) {
            log(bot, "Productive idle: chose smelting.");
            return true;
        }

        log(bot, "Productive idle: checking storage.");
        if (await storeUsefulItems(bot)) {
            log(bot, "Productive idle: chose storing items.");
            return true;
        }

        log(bot, "Productive idle: checking chest availability.");
        if (await ensureChestNearby(bot)) {
            if (await storeUsefulItems(bot)) {
                log(bot, "Productive idle: created/used chest and stored items.");
                return true;
            }
        }

        log(bot, "Productive idle: checking food hunting.");
        if (await huntNearbyFood(bot)) {
            log(bot, "Productive idle: chose hunting.");
            return true;
        }

        log(bot, "Productive idle: checking nearby ores.");
        if (await collectNearbyOres(bot, 4)) {
            log(bot, "Productive idle: chose ore collection.");
            return true;
        }

        log(bot, "Productive idle: nothing useful found.");
        return false;
    } catch (err) {
        log(bot, `Productive idle failed: ${err.message}`);
        return false;
    }
}
 /**
 * Sleep at night if a bed is nearby.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @returns {Promise<boolean>} true if sleep behavior was started, false otherwise.
 * @example
 * await skills.sleepIfNeeded(bot);
 */
export async function sleepIfNeeded(bot) {
    if (!bot || !bot.time) return false;

    // Roughly after sunset
    if (bot.time.timeOfDay < 12541) {
        return false;
    }

    try {
        return await goToBed(bot);
    } catch (err) {
        log(bot, `Could not go to bed: ${err.message}`);
        return false;
    }
}

/**
 * Smelt raw ores already in inventory.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @returns {Promise<boolean>} true if something was smelted, false otherwise.
 * @example
 * await skills.smeltInventoryOres(bot);
 */
export async function smeltInventoryOres(bot) {
    const counts = world.getInventoryCounts(bot);

    const priorities = [
        "raw_iron",
        "raw_copper",
        "raw_gold"
    ];

    for (const itemName of priorities) {
        const count = counts[itemName] || 0;
        if (count > 0) {
            try {
                await smeltItem(bot, itemName, count);
                return true;
            } catch (err) {
                log(bot, `Failed to smelt ${itemName}: ${err.message}`);
                return false;
            }
        }
    }

    return false;
}

/**
 * Store aggressive-surplus items in the nearest chest.
 * Keeps tools, armor, food, torches, building blocks, smelting inputs, and core utility items.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @returns {Promise<boolean>} true if anything was stored, false otherwise.
 * @example
 * await skills.storeUsefulItems(bot);
 */
export async function storeUsefulItems(bot) {
    const items = bot.inventory.items();
    if (!items || items.length === 0) return false;

    let storedAnything = false;

    // Strong keep list: do NOT store these by default
    const alwaysKeep = new Set([
        "raw_iron",
        "raw_copper",
        "raw_gold",
        "iron_ingot",
        "copper_ingot",
        "gold_ingot",
        "coal",
        "charcoal",
        "torch",
        "bed",
        "furnace",
        "crafting_table",
        "chest"
    ]);

    for (const item of items) {
        if (!item || !item.name) continue;

        const name = item.name;
        const count = item.count || 0;

        // Never store these core items
        if (alwaysKeep.has(name)) continue;

        // Never store tools/armor
        if (isToolOrArmorName(name)) continue;

        // Keep food on hand
        if (isFoodItemName(name)) continue;

        // Keep one stack of building blocks
        if (isBuildingBlockName(name)) {
            if (count > 64) {
                try {
                    await putInChest(bot, name, count - 64);
                    storedAnything = true;
                } catch (err) {
                    log(bot, `Could not store surplus ${name}: ${err.message}`);
                }
            }
            continue;
        }

        // Keep one stack of torches
        if (name === "torch") {
            if (count > 64) {
                try {
                    await putInChest(bot, name, count - 64);
                    storedAnything = true;
                } catch (err) {
                    log(bot, `Could not store surplus torches: ${err.message}`);
                }
            }
            continue;
        }

        // Keep some food, store only excess
        if (isFoodItemName(name)) {
            if (count > 32) {
                try {
                    await putInChest(bot, name, count - 32);
                    storedAnything = true;
                } catch (err) {
                    log(bot, `Could not store surplus food ${name}: ${err.message}`);
                }
            }
            continue;
        }

        // Store valuables, crops, drops, etc.
        if (shouldStoreItem(name, count)) {
            try {
                await putInChest(bot, name, count);
                storedAnything = true;
            } catch (err) {
                log(bot, `Could not store ${name}: ${err.message}`);
            }
        }
    }

    return storedAnything;
}

/**
 * Ensure there is a nearby chest if storage is needed.
 * Places an existing chest or crafts one if possible.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @returns {Promise<boolean>} true if a chest is nearby after this call, false otherwise.
 * @example
 * await skills.ensureChestNearby(bot);
 */
export async function ensureChestNearby(bot) {
    const nearbyChest = world.getNearestBlock(bot, "chest", 12);
    if (nearbyChest) return true;

    const invCounts = world.getInventoryCounts(bot);

    // If carrying inventory is not crowded, no need to create storage yet
    const carryStats = getCarryInventoryStats(bot);
    if (carryStats.used < 30) return false;

    // If already holding a chest, place it
    if ((invCounts["chest"] || 0) > 0) {
        const pos = world.getNearestFreeSpace(bot, 1, 6);
        await placeBlock(bot, "chest", pos.x, pos.y, pos.z);
        return !!world.getNearestBlock(bot, "chest", 12);
    }

    // Craft chest if enough planks exist
    const plankNames = Object.keys(invCounts).filter(name => name.endsWith("_planks"));
    const totalPlanks = plankNames.reduce((sum, name) => sum + (invCounts[name] || 0), 0);

    if (totalPlanks >= 8) {
        try {
            await craftRecipe(bot, "chest", 1);
        } catch (err) {
            log(bot, `Could not craft chest: ${err.message}`);
            return false;
        }

        const pos = world.getNearestFreeSpace(bot, 1, 6);
        await placeBlock(bot, "chest", pos.x, pos.y, pos.z);
        return !!world.getNearestBlock(bot, "chest", 12);
    }

    return false;
}

export const stashInventoryInNearbyChestDoc = `
Store excess carried inventory in a chest.
Uses a nearby chest, remembered chest, or creates a new chest if needed.
Returns: boolean
Example:
await skills.stashInventoryInNearbyChest(bot);
`;
export async function stashInventoryInNearbyChest(bot, options = {}) {
    const keepFood = options.keepFood ?? 16;

    // Step 1: find nearby chest
    let chestBlock = world.getNearestBlock(bot, 'chest', 12);

    // Step 2: if none nearby, try remembered chest
    if (!chestBlock && bot.agent?.memory_bank?.recallPlace) {
        const remembered = bot.agent.memory_bank.recallPlace('last_stash_chest');
        if (remembered) {
            log(bot, 'Returning to remembered chest...');
            await goToPosition(bot, remembered.x, remembered.y, remembered.z, 3);
            chestBlock = world.getNearestBlock(bot, 'chest', 12);
        }
    }

    // Step 3: if still none → create one
    if (!chestBlock) {
        log(bot, 'No chest found. Creating a new one...');
        const created = await ensureChestNearby(bot);
        if (!created) {
            log(bot, 'Failed to create chest.');
            return false;
        }
        chestBlock = world.getNearestBlock(bot, 'chest', 12);
    }

    if (!chestBlock) {
        log(bot, 'No chest available.');
        return false;
    }

    // Move to chest
    await goToNearestBlock(bot, 'chest', 3, 12);

    // Remember it
    if (bot.agent?.memory_bank?.rememberPlace) {
        bot.agent.memory_bank.rememberPlace(
            'last_stash_chest',
            chestBlock.position.x,
            chestBlock.position.y,
            chestBlock.position.z
        );
    }

    const chest = await bot.openContainer(chestBlock);

    let movedAnything = false;

    for (const item of bot.inventory.items()) {
        if (!item) continue;

        const name = item.name;

        // Keep tools / armor / essentials
        if (
            name.includes('pickaxe') ||
            name.includes('axe') ||
            name.includes('sword') ||
            name.includes('helmet') ||
            name.includes('chestplate') ||
            name.includes('leggings') ||
            name.includes('boots')
        ) continue;

        try {
            await chest.deposit(item.type, item.metadata, item.count);
            movedAnything = true;
        } catch (err) {
            // 🔥 THIS IS THE IMPORTANT PART
            if (err.message.includes('full')) {
                log(bot, 'Chest is full. Trying another chest...');

                await chest.close();

                // Try placing a new chest nearby
                const created = await ensureChestNearby(bot);
                if (!created) {
                    log(bot, 'Could not create another chest.');
                    return false;
                }

                const newChest = world.getNearestBlock(bot, 'chest', 6);
                if (!newChest) return false;

                await goToNearestBlock(bot, 'chest', 3, 6);

                const chest2 = await bot.openContainer(newChest);

                try {
                    await chest2.deposit(item.type, item.metadata, item.count);
                    movedAnything = true;
                } catch (err2) {
                    log(bot, `Still could not store ${name}`);
                }

                await chest2.close();
                return movedAnything;
            }
        }
    }

    await chest.close();

    if (movedAnything) {
        log(bot, 'Stored items successfully.');
    } else {
        log(bot, 'Nothing to store.');
    }

    return movedAnything;
}

/**
 * Hunt one nearby passive mob for food if useful.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @returns {Promise<boolean>} true if a hunt was started, false otherwise.
 * @example
 * await skills.huntNearbyFood(bot);
 */
export async function huntNearbyFood(bot) {
    const foodOnHand = bot.inventory.items().filter(item => isFoodItemName(item.name));
    const totalFoodCount = foodOnHand.reduce((sum, item) => sum + item.count, 0);

    if (bot.food >= 18 && totalFoodCount >= 16) {
        return false;
    }

    const targets = ["cow", "pig", "sheep", "chicken"];
    for (const mobType of targets) {
        const found = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
        if (found) {
            return await attackEntity(bot, found, true);
        }
    }

    return false;
}

/**
 * Collect a few nearby visible ores only.
 * This is a simple visible-ore gatherer, not full mining.
 * @param {MinecraftBot} bot, reference to the minecraft bot.
 * @param {number} maxCount, maximum ore blocks to gather.
 * @returns {Promise<boolean>} true if at least one ore was gathered, false otherwise.
 * @example
 * await skills.collectNearbyOres(bot, 4);
 */
export async function collectNearbyOres(bot, maxCount = 4) {
    if (!bot || !bot.entity) return false;

    const mcData = bot.registry || bot.mcData;
    const oreNames = getNearbyOreNames();

    let collected = 0;

    for (const oreName of oreNames) {
        const blockId = mcData?.blocksByName?.[oreName]?.id;
        if (!blockId) continue;

        while (collected < maxCount) {
            const target = bot.findBlock({
                matching: blockId,
                maxDistance: 24
            });

            if (!target) break;

            try {
                await goToPosition(
                    bot,
                    target.position.x,
                    target.position.y,
                    target.position.z,
                    3
                );

                const block = bot.blockAt(target.position);
                if (!block || block.name !== oreName) break;

                await bot.dig(block, true);
                collected++;
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (err) {
                log(bot, `Could not collect ${oreName}: ${err.message}`);
                break;
            }
        }

        if (collected >= maxCount) break;
    }

    if (collected > 0) {
        log(bot, `Collected ${collected} nearby ore block(s).`);
        return true;
    }

    return false;
}

export const craftAndEquipArmorSetDoc = `
Ensure materials exist, then craft and equip a full armor set for the given material.
Supports armor materials such as iron, golden, diamond, and leather.
Returns: boolean
Example:
await skills.craftAndEquipArmorSet(bot, "diamond");
`;
export async function craftAndEquipArmorSet(bot, material) {
    /**
     * Ensure materials exist, then craft and equip a full armor set.
     * Supports leather, iron, golden, and diamond directly.
     * Netherite is handled as a separate upgrade path and currently returns false
     * unless you add smithing-table upgrade support later.
     *
     * @param {MinecraftBot} bot
     * @param {string} material
     * @returns {Promise<boolean>}
     * @example
     * await skills.craftAndEquipArmorSet(bot, "diamond");
     */
    material = String(material || '').toLowerCase().trim();

    const supported = ['leather', 'iron', 'golden', 'diamond', 'netherite'];
    if (!supported.includes(material)) {
        log(bot, `Unsupported armor material: ${material}.`);
        return false;
    }

    if (material === 'netherite') {
        log(bot, 'Netherite armor requires smithing upgrade support. Craft diamond armor first, then upgrade.');
        return false;
    }

    const pieces = ['helmet', 'chestplate', 'leggings', 'boots'];

    const materialCounts = {
        leather: 24,
        iron: 24,
        golden: 24,
        diamond: 24
    };

    function countItem(itemName) {
        return bot.inventory.items()
            .filter(item => item.name === itemName)
            .reduce((sum, item) => sum + item.count, 0);
    }

    function hasArmorPiece(itemName) {
        return countItem(itemName) > 0 || bot.inventory.slots.some(slot => slot && slot.name === itemName);
    }

    // Figure out which pieces are still missing
    const missingPieces = pieces
        .map(piece => `${material}_${piece}`)
        .filter(itemName => !hasArmorPiece(itemName));

    if (missingPieces.length === 0) {
        log(bot, `Already have a full ${material} armor set. Equipping it now.`);
        let allEquipped = true;
        for (const piece of pieces) {
            const itemName = `${material}_${piece}`;
            const ok = await equip(bot, itemName);
            if (!ok) allEquipped = false;
        }
        return allEquipped;
    }

    // If we are missing armor pieces, ensure enough base material exists.
    const neededBaseMaterial = materialCounts[material] || 24;
    const invCounts = world.getInventoryCounts(bot);
    const currentBaseMaterial = invCounts[material] || 0;

    if (currentBaseMaterial < neededBaseMaterial) {
        const gotMaterials = await ensureItem(bot, material, neededBaseMaterial);
        if (!gotMaterials) {
            log(bot, `Could not gather enough ${material} to craft a full armor set.`);
            return false;
        }
    }

    let allGood = true;

    for (const piece of pieces) {
        const itemName = `${material}_${piece}`;

        if (!hasArmorPiece(itemName)) {
            const crafted = await craftRecipe(bot, itemName, 1);
            if (!crafted) {
                log(bot, `Could not craft ${itemName}.`);
                allGood = false;
                continue;
            }
        }

        const equipped = await equip(bot, itemName);
        if (!equipped) {
            log(bot, `Could not equip ${itemName}.`);
            allGood = false;
        }
    }

    return allGood;
}