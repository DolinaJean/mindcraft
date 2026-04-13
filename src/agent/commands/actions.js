import * as skills from "../library/skills.js";
import settings from "../settings.js";
import convoManager from "../conversation.js";

function runAsAction(actionFn, resume = false, timeout = -1) {
    let actionLabel = null;

    const wrappedAction = async function (agent, ...args) {
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj ? actionObj.name.substring(1) : "action";
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };

        const code_return = await agent.actions.runAction(
            `action:${actionLabel}`,
            actionFnWithAgent,
            { timeout, resume }
        );

        if (code_return.interrupted && !code_return.timedout) return;
        return code_return.message;
    };

    return wrappedAction;
}

export const actionsList = [
    {
        name: "!newAction",
        description: "Perform new and unknown custom behaviors that are not available as a command.",
        params: {
            prompt: { type: "string", description: "A natural language prompt to guide code generation. Make a detailed step-by-step plan." }
        },
        perform: async function (agent, prompt) {
            if (!settings.allow_insecure_coding) {
                agent.openChat("newAction is disabled. Enable with allow_insecure_coding=true in settings.js");
                return "newAction not allowed! Code writing is disabled in settings.";
            }

            let result = "";
            const actionFn = async () => {
                try {
                    console.log("[DEBUG newAction] Starting code generation");
                    console.log("[DEBUG newAction] Prompt:", prompt);
                    console.log("[DEBUG newAction] Bot connected:", !!agent.bot && !agent.bot._client?.ended);
                    console.log("[DEBUG newAction] Bot username:", agent.bot?.username);
                    console.log("[DEBUG newAction] Position:", agent.bot?.entity?.position);
                    console.log("[DEBUG newAction] Health/Food:", agent.bot?.health, agent.bot?.food);
                    console.log("[DEBUG newAction] Time:", new Date().toISOString());

                    result = await agent.coder.generateCode(agent.history);

                    console.log("[DEBUG newAction] Code generation completed");
                } catch (e) {
                    console.error("[DEBUG newAction] Code generation failed:", e);
                    result = "Error generating code: " + e.toString();
                }
            };

            await agent.actions.runAction("action:newAction", actionFn, { timeout: settings.code_timeout_mins });
            return result;
        }
    },


    {
        name: "!stop",
        description: "Force stop all actions and commands that are currently executing.",
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();

            const bot = agent.bot;
            if (bot) {
                bot.clearControlStates();
                if (typeof bot.stopDigging === "function") bot.stopDigging();
                if (bot.collectBlock?.stop) bot.collectBlock.stop();
                if (bot.pvp?.stop) bot.pvp.stop();
                if (bot.ashfinder?.stop) bot.ashfinder.stop();
                if (bot.baritone?.stop) bot.baritone.stop();
                bot.emit("idle");
            }

            let msg = "Agent stopped.";
            if (agent.self_prompter.isActive()) msg += " Self-prompting still active.";
            return msg;
        }
    },

    {
        name: ";stfu",
        description: "Stop all chatting and self prompting, but continue current action.",
        perform: async function (agent) {
            agent.openChat("Shutting up.");
            agent.shutUp();
            return;
        }
    },

    {
        name: "!restart",
        description: "Restart the agent process.",
        perform: async function (agent) {
            agent.cleanKill();
        }
    },

    {
        name: "!clearChat",
        description: "Clear the chat history.",
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },

{
		name: "!descendTower",
		description: "Remove the crooked tower under the bot and descend to natural ground.",
		params: {
			max_steps: { type: "int", description: "Maximum number of descent steps." }
		},
		perform: runAsAction(async (agent, max_steps = 80) => {
			await skills.descendTower(agent.bot, Number(max_steps));
		})
	},

	{
		name: "!moveTo",
		description: "Go to the given x, y, z location.",
		params: {
			x: { type: "float", description: "The x coordinate." },
			y: { type: "float", description: "The y coordinate." },
			z: { type: "float", description: "The z coordinate." }
		},
		perform: runAsAction(async (agent, x, y, z) => {
			await skills.moveTo(agent.bot, Number(x), Number(y), Number(z), 2);
		})
	},

    {
        name: "!goToCoordinates",
        description: "Go to the given x, y, z location.",
        params: {
            x: { type: "float", description: "The x coordinate." },
            y: { type: "float", description: "The y coordinate." },
            z: { type: "float", description: "The z coordinate." },
            closeness: { type: "float", description: "How close to get to the location." }
        },
        perform: runAsAction(async (agent, x, y, z, closeness = 2) => {
            await skills.goToPosition(agent.bot, Number(x), Number(y), Number(z), Number(closeness));
        })
    },

    {
        name: "!goToPlayer",
        description: "Go to the given player.",
        params: {
            player_name: { type: "string", description: "The name of the player to go to." },
            closeness: { type: "float", description: "How close to get to the player." }
        },
        perform: runAsAction(async (agent, player_name, closeness = 3) => {
            await skills.goToPlayer(agent.bot, player_name, Number(closeness));
        })
    },

    {
        name: "!followPlayer",
        description: "Follow the given player.",
        params: {
            player_name: { type: "string", description: "The player to follow." },
            follow_dist: { type: "float", description: "The follow distance." }
        },
        perform: runAsAction(async (agent, player_name, follow_dist = 3) => {
            await skills.followPlayer(agent.bot, player_name, Number(follow_dist));
        }, true)
    },

    {
        name: "!follow",
        description: "Alias for !followPlayer.",
        params: {
            player_name: { type: "string", description: "The player to follow." },
            follow_dist: { type: "float", description: "The follow distance." }
        },
        perform: runAsAction(async (agent, player_name, follow_dist = 3) => {
            await skills.followPlayer(agent.bot, player_name, Number(follow_dist));
        }, true)
    },

    {
        name: "!searchForBlock",
        description: "Find and go to the nearest block of a given type.",
        params: {
            type: { type: "BlockName", description: "The block type to go to." },
            search_range: { type: "float", description: "The range to search." }
        },
        perform: runAsAction(async (agent, block_type, range = 64) => {
            await skills.goToNearestBlock(agent.bot, block_type, 4, Number(range));
        })
    },

    {
        name: "!searchForEntity",
        description: "Find and go to the nearest entity of a given type.",
        params: {
            type: { type: "string", description: "The type of entity to go to." },
            search_range: { type: "float", description: "The range to search." }
        },
        perform: runAsAction(async (agent, entity_type, range = 64) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, Number(range));
        })
    },

    {
        name: "!moveAway",
        description: "Move away from the current location.",
        params: {
            distance: { type: "float", description: "The distance to move away." }
        },
        perform: runAsAction(async (agent, distance = 8) => {
            await skills.moveAway(agent.bot, Number(distance));
        })
    },

    {
        name: "!rememberHere",
        description: "Save the current location with a given name.",
        params: {
            name: { type: "string", description: "The name to remember the location as." }
        },
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },

    {
        name: "!goToRememberedPlace",
        description: "Go to a saved location.",
        params: {
            name: { type: "string", description: "The name of the location to go to." }
        },
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
                skills.log(agent.bot, `No location named "${name}" saved.`);
                return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },

    {
        name: "!givePlayer",
        description: "Give the specified item to the given player.",
        params: {
            player_name: { type: "string", description: "The player to give the item to." },
            item_name: { type: "ItemName", description: "The item to give." },
            num: { type: "int", description: "The number of items to give." }
        },
        perform: runAsAction(async (agent, player_name, item_name, num = 1) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, Number(num));
        })
    },

    {
        name: "!consume",
        description: "Eat or drink the given item.",
        params: {
            item_name: { type: "ItemName", description: "The item to consume." }
        },
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },

    {
        name: "!equip",
        description: "Equip the given item.",
        params: {
            item_name: { type: "ItemName", description: "The item to equip." }
        },
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },

    {
        name: "!putInChest",
        description: "Put the given item in the nearest chest.",
        params: {
            item_name: { type: "ItemName", description: "The item to put in the chest." },
            num: { type: "int", description: "The number of items to store." }
        },
        perform: runAsAction(async (agent, item_name, num = -1) => {
            await skills.putInChest(agent.bot, item_name, Number(num));
        })
    },

    {
        name: "!takeFromChest",
        description: "Take the given item from the nearest chest.",
        params: {
            item_name: { type: "ItemName", description: "The item to take." },
            num: { type: "int", description: "The number of items to take." }
        },
        perform: runAsAction(async (agent, item_name, num = -1) => {
            await skills.takeFromChest(agent.bot, item_name, Number(num));
        })
    },

    {
        name: "!viewChest",
        description: "View the contents of the nearest chest.",
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },

    {
        name: "!discard",
        description: "Discard the given item.",
        params: {
            item_name: { type: "ItemName", description: "The item to discard." },
            num: { type: "int", description: "The number of items to discard." }
        },
        perform: runAsAction(async (agent, item_name, num = -1) => {
            await skills.discard(agent.bot, item_name, Number(num));
        })
    },

    {
        name: "!collectBlocks",
        description: "Collect the nearest blocks of a given type.",
        params: {
            type: { type: "BlockName", description: "The block type to collect." },
            num: { type: "int", description: "The number of blocks to collect." }
        },
        perform: runAsAction(async (agent, type, num = 1) => {
            await skills.collectBlock(agent.bot, type, Number(num));
        }, false, 10)
    },

    {
        name: "!breakBlockAt",
        description: "Break the block at x y z.",
        params: {
            x: { type: "float", description: "The x coordinate." },
            y: { type: "float", description: "The y coordinate." },
            z: { type: "float", description: "The z coordinate." }
        },
        perform: runAsAction(async (agent, x, y, z) => {
            await skills.breakBlockAt(agent.bot, Number(x), Number(y), Number(z));
        })
    },

    {
        name: "!placeBlock",
        description: "Place the given block type at x y z.",
        params: {
            type: { type: "BlockOrItemName", description: "The block type to place." },
            x: { type: "float", description: "The x coordinate." },
            y: { type: "float", description: "The y coordinate." },
            z: { type: "float", description: "The z coordinate." },
            side: { type: "string", description: "Preferred side: top, bottom, north, south, east, west, side." }
        },
        perform: runAsAction(async (agent, type, x, y, z, side = "bottom") => {
            await skills.placeBlock(agent.bot, type, Number(x), Number(y), Number(z), side);
        })
    },

    {
        name: "!placeHere",
        description: "Place a given block in the current location.",
        params: {
            type: { type: "BlockOrItemName", description: "The block type to place." }
        },
        perform: runAsAction(async (agent, type) => {
            const pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },

    {
        name: "!craft",
        description: "Craft the given recipe a given number of times.",
        params: {
            recipe_name: { type: "ItemName", description: "The output item to craft." },
            num: { type: "int", description: "The number of times to craft." }
        },
        perform: runAsAction(async (agent, recipe_name, num = 1) => {
            await skills.craftRecipe(agent.bot, recipe_name, Number(num));
        })
    },

{
    name: "!craftRecipe",
    description: "Alias for !craft",
    params: {
        recipe_name: { type: "ItemName", description: "The output item to craft." },
        num: { type: "int", description: "The number of times to craft." }
    },
    perform: runAsAction(async (agent, recipe_name, num = 1) => {
        await skills.craftRecipe(agent.bot, recipe_name, Number(num));
    })
},

    {
        name: "!smeltItem",
        description: "Smelt the given item.",
        params: {
            item_name: { type: "ItemName", description: "The input item to smelt." },
            num: { type: "int", description: "The number of items to smelt." }
        },
        perform: runAsAction(async (agent, item_name, num = 1) => {
            await skills.smeltItem(agent.bot, item_name, Number(num));
        })
    },

{
    name: "!smelt",
    description: "Alias for !smeltItem",
    params: {
            item_name: { type: "ItemName", description: "The input item to smelt." },
            num: { type: "int", description: "The number of items to smelt." }
        },
        perform: runAsAction(async (agent, item_name, num = 1) => {
            await skills.smeltItem(agent.bot, item_name, Number(num));
        })
    },

    {
        name: "!clearFurnace",
        description: "Take all items out of the nearest furnace.",
        perform: runAsAction(async (agent) => {
            await skills.clearFurnace(agent.bot);
        })
    },

    {
        name: "!attack",
        description: "Attack and kill the nearest entity of a given type.",
        params: {
            type: { type: "string", description: "The type of entity to attack." }
        },
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },

    {
		name: "!attackPlayer",
		description: "Attack a specific player.",
		params: {
			player_name: { type: "string", description: "The player to attack." }
		},
		perform: runAsAction(async (agent, player_name) => {
			await skills.defend_self(agent.bot, player_name);
		})
	},

    {
        name: "!goToBed",
        description: "Go to the nearest bed and sleep.",
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },

    {
    name: "!stay",
    description: "Stay in the current location.",
    params: {
        seconds: { type: "int", description: "The number of seconds to stay. -1 for forever." }
    },
    perform: runAsAction(async (agent, seconds = 30) => {
        const bot = agent.bot;
        seconds = Number(seconds);

        if (Number.isNaN(seconds)) {
            seconds = 30;
        }

        if (seconds === -1) {
            while (!bot.interrupt_code) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            return;
        }

        const start = Date.now();
        while ((Date.now() - start) < seconds * 1000) {
            if (bot.interrupt_code) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    })
},

{
    name: "!setMode",
    description: "Set a mode to on or off.",
    params: {
        mode_name: { type: "string", description: "The mode to change." },
        on: { type: "boolean", description: "Whether to enable or disable the mode." }
    },
    perform: async function (agent, mode_name, on) {
        const modes = agent.bot.modes;

        if (!modes.exists(mode_name)) {
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
        }

        const enabled = String(on).toLowerCase() === "true";

        if (modes.isOn(mode_name) === enabled) {
            return `Mode ${mode_name} is already ${enabled ? "on" : "off"}.`;
        }

        modes.setOn(mode_name, enabled);

        if (!enabled) {
            modes.pause(mode_name);
        } else {
            modes.unpause(mode_name);
        }

        return `Mode ${mode_name} is now ${enabled ? "on" : "off"}.`;
    }
},
{
    name: "!goal",
    description: "Set a goal prompt to endlessly work towards with continuous self-prompting.",
    params: {
        selfPrompt: { type: "string", description: "The goal prompt." }
    },
    perform: async function (agent, prompt) {
        if (convoManager.inConversation()) agent.self_prompter.setPromptPaused(prompt);
        else agent.self_prompter.start(prompt);
    }
},

    {
        name: "!endGoal",
        description: "Stop self-prompting.",
        perform: async function (agent) {
            agent.self_prompter.stop();
            return "Self-prompting stopped.";
        }
    },

    {
		name: "!showVillagerTrades",
		description: "Show trades of the nearest villager, or a specific villager id if provided.",
		params: {
			id: { type: "int", description: "Optional villager id. Use -1 to select the nearest villager." }
		},
		perform: runAsAction(async (agent, id = -1) => {
			await skills.showVillagerTrades(agent.bot, Number(id));
		})
	},

    {
        name: "!tradeWithVillager",
        description: "Trade with a specified villager.",
        params: {
            id: { type: "int", description: "The villager id." },
            index: { type: "int", description: "The 1-based trade index." },
            count: { type: "int", description: "How many times to execute that trade." }
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },

    {
        name: "!startConversation",
        description: "Start a conversation with a bot. FOR OTHER BOTS ONLY.",
        params: {
            player_name: { type: "string", description: "The bot to talk to." },
            message: { type: "string", description: "The message to send." }
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name)) {
                return player_name + " is not a bot, cannot start conversation.";
            }
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) {
                convoManager.forceEndCurrentConversation();
            } else if (convoManager.inConversation(player_name)) {
                agent.history.add("system", "You are already in conversation with " + player_name + ". Do not use this command to talk to them.");
            }
            convoManager.startConversation(player_name, message);
        }
    },

    {
        name: "!endConversation",
        description: "End the conversation with the given bot.",
        params: {
            player_name: { type: "string", description: "The bot to stop talking to." }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name)) {
                return `Not in conversation with ${player_name}.`;
            }
            convoManager.endConversation(player_name);
            return `Conversation with ${player_name} ended.`;
        }
    },

    {
        name: "!lookAtPlayer",
        description: "Look at a player or in the same direction as the player.",
        params: {
            player_name: { type: "string", description: "Name of the target player." },
            direction: { type: "string", description: "Either at or with." }
        },
        perform: async function (agent, player_name, direction) {
            if (direction !== "at" && direction !== "with") {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction("action:lookAtPlayer", actionFn);
            return result;
        }
    },

    {
        name: "!lookAtPosition",
        description: "Look at specified coordinates.",
        params: {
            x: { type: "int", description: "x coordinate" },
            y: { type: "int", description: "y coordinate" },
            z: { type: "int", description: "z coordinate" }
        },
        perform: async function (agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction("action:lookAtPosition", actionFn);
            return result;
        }
    },

    {
        name: "!digDown",
        description: "Dig down a specified distance.",
        params: {
            distance: { type: "int", description: "Distance to dig down." }
        },
        perform: runAsAction(async (agent, distance = 1) => {
            await skills.digDown(agent.bot, Number(distance));
        })
    },

    {
        name: "!goToSurface",
        description: "Move the bot to the surface.",
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },

    {
        name: "!useOn",
        description: "Use the given tool on the nearest target.",
        params: {
            tool_name: { type: "string", description: "Tool name, or hand." },
            target: { type: "string", description: "Target entity/block type, or nothing." }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
	
	{
    name: "!productiveIdleNow",
    description: "Run one productive idle task immediately.",
    perform: runAsAction(async (agent) => {
        await skills.runProductiveIdle(agent.bot);
    })
},
{
    name: "!smeltInventoryOres",
    description: "Smelt raw ores currently in inventory.",
    perform: runAsAction(async (agent) => {
        await skills.smeltInventoryOres(agent.bot);
    })
},
{
    name: "!storeUsefulItems",
    description: "Store aggressive-surplus items in the nearest chest.",
    perform: runAsAction(async (agent) => {
        await skills.storeUsefulItems(agent.bot);
    })
},
{
    name: "!ensureChestNearby",
    description: "Make sure a chest exists nearby if storage is needed.",
    perform: runAsAction(async (agent) => {
        await skills.ensureChestNearby(agent.bot);
    })
},
{
    name: "!sleepIfNeeded",
    description: "Go to bed if it is late enough and a bed is nearby.",
    perform: runAsAction(async (agent) => {
        await skills.sleepIfNeeded(agent.bot);
    })
},
{
    name: "!huntNearbyFood",
    description: "Hunt one nearby passive food mob if useful.",
    perform: runAsAction(async (agent) => {
        await skills.huntNearbyFood(agent.bot);
    })
},
{
    name: "!collectNearbyOres",
    description: "Collect a few visible nearby ore blocks.",
    params: {
        max_count: { type: "int", description: "Maximum number of nearby ore blocks to gather." }
    },
    perform: runAsAction(async (agent, max_count) => {
        await skills.collectNearbyOres(agent.bot, Number(max_count));
    })
}
];

export default actionsList;