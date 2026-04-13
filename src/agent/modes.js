// ./src/agent/modes.js 

import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

function applyProfileModeSettings(agent) {
    const profileModes = agent?.prompter?.profile?.modes || {};
    const modeController = agent.bot.modes;

    for (const [modeName, enabled] of Object.entries(profileModes)) {
        if (!modeController.exists(modeName)) continue;
        modeController.setOn(modeName, Boolean(enabled));
    }

    console.log("Applied profile modes:", profileModes);
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
{
    name: 'self_preservation',
    description: 'Respond to drowning, burning, nearby hostiles, and recent damage. Interrupts all actions.',
    interrupts: ['all'],
    on: true,
    active: false,
    cooldown: 1500,
    last_announce_time: 0,
    last_announce_key: null,
    announce_cooldown_ms: 4000,
    fall_blocks: ['sand', 'gravel', 'concrete_powder'],
    update: async function (agent) {
        const bot = agent.bot;
        let block = bot.blockAt(bot.entity.position);
        let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));

        if (!block) block = { name: 'air' };
        if (!blockAbove) blockAbove = { name: 'air' };

        const nearbyHostile = world.getNearestEntityWhere(
            bot,
            entity => entity && mc.isHostile(entity),
            10
        );

        const recentlyDamaged = Date.now() - bot.lastDamageTime < 4000;
        const lowHealth = bot.health <= 10;
        const criticalHealth = bot.health <= 6;

        const sayOnce = (key, message) => {
            const now = Date.now();
            const changed = this.last_announce_key !== key;
            const cooledDown = now - this.last_announce_time > this.announce_cooldown_ms;

            if (changed || cooledDown) {
                say(agent, message);
                this.last_announce_key = key;
                this.last_announce_time = now;
            }
        };

        if (blockAbove.name === 'water') {
            if (!bot.ashfinder?.goal) {
                bot.setControlState('jump', true);
            }
            return;
        }

        if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
            sayOnce('falling_block', 'That block is collapsing!');
            execute(this, agent, async () => {
                await skills.moveAway(bot, 2);
                return 'moved away from falling block';
            });
            return;
        }

        if (
            block.name === 'lava' || block.name === 'fire' ||
            blockAbove.name === 'lava' || blockAbove.name === 'fire'
        ) {
            sayOnce('on_fire', "I'm on fire!");

            let waterBucket = bot.inventory.findInventoryItem('water_bucket');
            if (waterBucket) {
                execute(this, agent, async () => {
                    const success = await skills.placeBlock(
                        bot,
                        'water_bucket',
                        block.position.x,
                        block.position.y,
                        block.position.z
                    );
                    if (success) {
                        say(agent, "Placed some water, ahhhh that's better!");
                        return 'extinguished with water bucket';
                    }

                    await skills.moveAway(bot, 5);
                    return 'moved away from fire';
                });
            } else {
                execute(this, agent, async () => {
                    const nearestWater = world.getNearestBlock(bot, 'water', 20);
                    if (nearestWater) {
                        const pos = nearestWater.position;
                        const success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                        if (success) {
                            say(agent, "Found some water, ahhhh that's better!");
                            return 'escaped to water';
                        }
                    }

                    await skills.moveAway(bot, 5);
                    return 'moved away from fire';
                });
            }
            return;
        }

        if (nearbyHostile && (criticalHealth || recentlyDamaged || lowHealth)) {
            sayOnce(`retreat_${nearbyHostile.name}`, `Retreating from ${nearbyHostile.name}!`);
            execute(this, agent, async () => {
                await skills.moveAwayFromEntity(bot, nearbyHostile, 16);
                return `retreated from ${nearbyHostile.name}`;
            });
            return;
        }

        if (recentlyDamaged && (lowHealth || bot.lastDamageTaken >= 2)) {
            sayOnce('hurt', "I'm hurt!");
            execute(this, agent, async () => {
                await skills.moveAway(bot, 12);
                return 'retreated after taking damage';
            });
            return;
        }

        if (agent.isIdle()) {
            bot.clearControlStates();
            this.last_announce_key = null;
        }
    }
},
    {
    name: 'unstuck',
    description: 'Attempt to get unstuck when in the same place for a while. Interrupts only when truly stuck.',
    interrupts: ['all'],
    on: false,
    active: false,
    prev_location: null,
    distance: 1.0,
    stuck_time: 0,
    last_time: Date.now(),
    max_stuck_time: 20,
    prev_dig_block: null,
    cooldown_until: 0,

    update: async function (agent) {
        const now = Date.now();

        // Do not run while idle
        if (agent.isIdle()) {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
            this.last_time = now;
            return;
        }

        // Cooldown after an unstuck attempt
        if (now < this.cooldown_until) {
            this.last_time = now;
            return;
        }

        const bot = agent.bot;
        const currentAction = agent.actions.currentActionLabel || '';
        const cur_dig_block = bot.targetDigBlock;

        // Track digging target if present
        if (cur_dig_block && !this.prev_dig_block) {
            this.prev_dig_block = cur_dig_block;
        }

        // Do not trigger unstuck too aggressively during normal movement/pathing actions
        const movementActions = [
            'action:goToCoordinates',
            'action:goToPlayer',
            'action:moveTo',
            'action:followPlayer',
            'action:follow',
            'action:searchForBlock',
            'action:searchForEntity',
            'action:collectBlocks',
            'action:descendTower'
        ];

        const doingMovementAction = movementActions.some(name => currentAction.includes(name));

        // Measure whether the bot has meaningfully moved
        const hasPrev = !!this.prev_location;
        const movedEnough = hasPrev && this.prev_location.distanceTo(bot.entity.position) >= this.distance;
        const sameDigTarget = cur_dig_block == this.prev_dig_block;

        // If doing a normal movement action and still making progress, do not count as stuck
        if (doingMovementAction && movedEnough) {
            this.prev_location = bot.entity.position.clone();
            this.stuck_time = 0;
            this.prev_dig_block = cur_dig_block || null;
            this.last_time = now;
            return;
        }

        // Build stuck timer
        if (hasPrev && !movedEnough && sameDigTarget) {
            this.stuck_time += (now - this.last_time) / 1000;
        } else {
            this.prev_location = bot.entity.position.clone();
            this.stuck_time = 0;
            this.prev_dig_block = cur_dig_block || null;
            this.last_time = now;
            return;
        }

        const max_stuck_time = cur_dig_block?.name === 'obsidian'
            ? this.max_stuck_time * 2
            : this.max_stuck_time;

        if (this.stuck_time > max_stuck_time) {
            say(agent, 'I am stuck.');
            this.stuck_time = 0;
            this.cooldown_until = now + 8000;

            execute(this, agent, async () => {
                const crashTimeout = setTimeout(() => {
                    agent.cleanKill("Got stuck and could not get unstuck");
                }, 10000);

                // Hard stop pathing before trying to move away
                bot.clearControlStates();
                if (bot.ashfinder && typeof bot.ashfinder.stop === 'function') {
                    bot.ashfinder.stop();
                }

                await skills.moveAway(bot, 3);

                clearTimeout(crashTimeout);
                say(agent, 'I am free.');
            });
        }

        this.last_time = now;
    },

    unpause: function () {
        this.prev_location = null;
        this.stuck_time = 0;
        this.prev_dig_block = null;
        this.cooldown_until = 0;
    }
},

{
    name: 'cowardice',
    description: 'Run away from enemies. Interrupts all actions.',
    interrupts: ['all'],
    on: true,
    active: false,
    current_target_name: null,
    announced_start: false,
    announced_end: false,
    update: async function (agent) {
        const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16);

        if (enemy && await world.isClearPath(agent.bot, enemy)) {
            const name = enemy.name.replace("_", " ");

            if (this.current_target_name !== enemy.name) {
                this.current_target_name = enemy.name;
                this.announced_start = false;
                this.announced_end = false;
            }

            if (!this.announced_start) {
                say(agent, `Running from ${name}!`);
                this.announced_start = true;
            }

            execute(this, agent, async () => {
                await skills.avoidEnemies(agent.bot, 24);
            });
        } else {
            if (this.current_target_name && !this.announced_end) {
                say(agent, `Safe from ${this.current_target_name.replace("_", " ")}.`);
                this.announced_end = true;
            }

            this.current_target_name = null;
            this.announced_start = false;
            this.announced_end = false;
        }
    }
},
	
	{
		name: 'self_defense',
		description: 'Attack nearby enemies. Interrupts all actions.',
		interrupts: ['all'],
		on: true,
		active: false,
		current_target_name: null,
		announced_start: false,
		announced_end: false,
		update: async function (agent) {
			const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 8);

			if (enemy && await world.isClearPath(agent.bot, enemy)) {
            if (agent.bot.health <= 8) {
                return;
            }
				if (this.current_target_name !== enemy.name) {
					this.current_target_name = enemy.name;
					this.announced_start = false;
					this.announced_end = false;
				}

				if (!this.announced_start) {
					say(agent, `Fighting ${enemy.name}!`);
					this.announced_start = true;
				}

				execute(this, agent, async () => {
                await skills.equipHighestAttack(agent.bot);

                if (agent.bot.food < 10 && agent.bot.autoEat) {
                    try {
                        await agent.bot.autoEat.eat();
                    } catch (err) {
                        // ignore eat failure during combat
                    }
                }

                await skills.self_defense(agent.bot, 8);
            });
			
			} else {
				if (this.current_target_name && !this.announced_end) {
					say(agent, `I got the ${this.current_target_name}!`);
					this.announced_end = true;
				}

				this.current_target_name = null;
				this.announced_start = false;
				this.announced_end = false;
			}
		}
	},    
{
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
		cooldown: 30000,
        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            const entity = agent.bot.nearestEntity();
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata[16];
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    },
	{
    name: 'productive_idle',
    description: 'Chains useful idle tasks while safe: sleep, smelt, store items, create storage, hunt food, and gather visible ores.',
    interrupts: [],
    on: false,
    active: false,
    cooldown_until: 0,

    update: async function (agent) {
        const bot = agent.bot;

        // Only run when truly idle
        if (!agent.isIdle()) return;

        // Respect cooldown
        if (Date.now() < this.cooldown_until) return;

        // Safety gates
        if (!bot || !bot.entity) return;
        if (bot.health < 10) return;
        if (bot.pvp?.target) return;

        // Do not fight active prompting/conversation work
        if (agent.self_prompter?.isActive && agent.self_prompter.isActive()) {
            return;
        }

        execute(this, agent, async () => {
            let didAnything = false;
            let safetyCounter = 0;

            while (agent.isIdle() && safetyCounter < 12) {
                safetyCounter++;

                if (bot.interrupt_code) break;
                if (bot.health < 10) break;
                if (bot.pvp?.target) break;

                const didWork = await skills.runProductiveIdle(bot);

                if (!didWork) {
                    break;
                }

                didAnything = true;

                // small pause between chained tasks
                await skills.wait(bot, 1500);
            }

            // shorter cooldown if productive, longer if nothing useful found
            this.cooldown_until = Date.now() + (didAnything ? 5000 : 20000);
        });
    },

    unpause: function () {
        this.cooldown_until = 0;
    }
}

];

async function execute(mode, agent, func, timeout = -1) {
    // Per-mode cooldown store on the agent
    if (!agent._modeCooldowns) {
        agent._modeCooldowns = {};
    }

    const now = Date.now();
    const cooldownMs = mode.cooldown ?? 20000;
    const lastRun = agent._modeCooldowns[mode.name] || 0;

    // Prevent tight loops
    if (now - lastRun < cooldownMs) {
        return;
    }
    agent._modeCooldowns[mode.name] = now;

    if (agent.self_prompter.isActive()) {
        agent.self_prompter.stopLoop();
    }

    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;

    let code_return;
    try {
        code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
            await func();
        }, { timeout });
    } finally {
        mode.active = false;
    }

    const rawMessage = code_return?.message ?? '';
    const cleanedMessage = String(rawMessage).replace('Action output:', '').trim();
    const lowerMessage = String(rawMessage).toLowerCase().trim();
    const wasSkipped = lowerMessage.startsWith('skipped mode:');

    // Only log meaningful results
    if (!cleanedMessage) {
        // Mode actions often succeed without returning text.
        // Do not treat missing text output as an error.
        return;
    }

	if (!wasSkipped) {
		console.log(`Mode ${mode.name} finished executing, code_return: ${rawMessage}`);
	}

    let should_reprompt =
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return?.interrupted && // this mode action was not interrupted by something else
        !wasSkipped; // skipped modes did not actually interrupt anything

    // Never auto-reprompt for these reactive combat/recovery modes
    if (should_reprompt && mode.name !== 'unstuck' && mode.name !== 'self_defense') {
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(
            role,
            `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
Your behavior log: ${logs}\nRespond accordingly.`
        );
    }
}

let _agent = null;
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        if (_agent.isIdle()) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                await mode.update(_agent);
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

// HELPER THINGY
export function initModes(agent) {
    _agent = agent;

    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();

    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }

    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }

    // Apply per-profile mode overrides from dingbat.json
    const profileModes = agent.prompter.profile?.modes || {};
    for (const [modeName, enabled] of Object.entries(profileModes)) {
        if (agent.bot.modes.exists(modeName)) {
            agent.bot.modes.setOn(modeName, Boolean(enabled));
        }
    }

    console.log("Applied profile modes:", profileModes);
}