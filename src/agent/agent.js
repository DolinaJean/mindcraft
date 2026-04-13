import { History } from './history.js';
import { Coder } from './coder.js';
import * as skills from './library/skills.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);

        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }

        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }

        const taskStart = save_data ? save_data.taskStart : Date.now();
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, '[agent.js initBot ln 70] Logging into minecraft...');
        this.bot = initBot(this.name);
		
		// give skills access to the agent + memory_bank
		this.bot.agent = this;
		
        console.log('[agent.js initBot] Ashfinder loaded:', !!this.bot.ashfinder);

        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;
            handleDisconnection(this.name, reason);
            process.exit(1);
        };

        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                onDisconnect('Error', err);
            } else {
                log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            serverProxy.login();

            if (this.prompter.profile.skin) {
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            } else {
                this.bot.chat('/skin clear');
            }
        });

        const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);

        this.bot.once('spawn', async () => {
            console.log('Ashfinder after spawn:', !!this.bot.ashfinder);
            console.log('Baritone after spawn:', !!this.bot.baritone);

            try {
                clearTimeout(spawnTimeout);

                // Reduce chunk/network pressure as early as possible
                if (this.bot.settings) {
                    this.bot.settings.viewDistance = 'tiny';
                }

                // Optional Baritone tuning for laggier Oracle/VPN/VMware routes
                if (this.bot.baritone && this.bot.baritone.settings) {
                    this.bot.baritone.settings.primaryTimeoutMS = 2000;
                    this.bot.baritone.settings.failureTimeoutMS = 5000;
                }

                await this.bot.waitForChunksToLoad();

                if (this.bot.ashfinder) {
                    // Keep pathfinding responsive without letting it hang forever
                    this.bot.ashfinder.config.thinkTimeout = 30000;
                    this.bot.ashfinder.config.chunkCaching = true;
                    this.bot.ashfinder.config.breakBlocks = true;
                    this.bot.ashfinder.config.placeBlocks = true;
                }

                if (this.bot.autoEat) {
                    this.bot.autoEat.setOpts({
                        priority: 'foodPoints',
                        minHunger: 14,
                        bannedFood: [
                            'rotten_flesh',
                            'spider_eye',
                            'poisonous_potato',
                            'pufferfish',
                            'chicken'
                        ]
                    });
                    this.bot.autoEat.enableAuto();
                }

                if (this.bot.armorManager) {
                    await this.bot.armorManager.equipAll();
                }

                await new Promise((resolve) => setTimeout(resolve, 3000));

                if (!this.vision_interpreter) {
                    console.log('Initializing vision interpreter...');
                    this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);
                    addBrowserViewer(this.bot, this.count_id);
                }

                console.log(`${this.name} spawned.`);
                this.clearBotLogs();

                await this._setupEventHandlers(save_data, init_message);
                this.startEvents();

                if (settings.task) {
                    this.task.setAgentGoal();
                    if (!load_mem) {
                        this.task.initBotTask();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (err) {
                console.error(`${this.name} spawn setup failed:`, err);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignoreMessages = [
            'Set own game mode to',
            'Set the time to',
            'Set the difficulty to',
            'Teleported ',
            'Set the weather to',
            'Gamerule '
        ];

        const shouldIgnoreMessage = (username, message) => {
            if (!message || message.trim() === '') return true;
            if (username === this.name) return true;
            if (username === this.bot.username) return true;

            if (
                settings.only_chat_with.length > 0 &&
                !settings.only_chat_with.includes(username)
            ) {
                return true;
            }

            if (ignoreMessages.some((prefix) => message.startsWith(prefix))) {
                return true;
            }

            return false;
        };

        const handleGoToCoordinates = async (message) => {
            const coords = message
                .replace(/,/g, ' ')
                .trim()
                .split(/\s+/)
                .slice(2);

            const x = parseFloat(coords[0]);
            const y = parseFloat(coords[1]);
            const z = parseFloat(coords[2]);

            if ([x, y, z].some(Number.isNaN)) {
                this.bot.chat('Use: go to <x> <y> <z>');
                return true;
            }

            this.bot.chat(`Understood. Moving to ${x} ${y} ${z}.`);

            try {
                await skills.goToPosition(this.bot, x, y, z, 2);
                this.bot.chat('I arrived.');
            } catch (err) {
                console.error('Movement failed:', err);
                this.bot.chat(`I could not get there: ${err.message}`);
            }

            return true;
        };

        const handleGoToPlayer = async (targetName) => {
            const target = this.bot.players[targetName]?.entity;
            if (!target) {
                this.bot.chat(`Could not find ${targetName}.`);
                return true;
            }

            try {
                await skills.goToPosition(
                    this.bot,
                    target.position.x,
                    target.position.y,
                    target.position.z,
                    2
                );
                this.bot.chat(`Going to ${targetName}.`);
            } catch (err) {
                console.error('Go to player failed:', err);
                this.bot.chat(`Could not reach ${targetName}.`);
            }

            return true;
        };

        const respondFunc = async (username, message) => {
            if (shouldIgnoreMessage(username, message)) return;

            try {
                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??');
                    return;
                }

                const translation = await handleEnglishTranslation(message);
                this.handleMessage(username, translation);
            } catch (error) {
                console.error('Error handling message:', error);
            }
        };

        this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);

        this.bot.on('chat', async (username, message) => {
            if (!message || !message.trim()) return;
            if (username === this.bot.username || username === this.name) return;

            const normalized = message.trim().toLowerCase();

            if (normalized.startsWith('go to ')) {
                const afterGoTo = message.trim().slice(6).trim();
                const coordText = afterGoTo.replace(/,/g, ' ');

                if (/^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?$/.test(coordText)) {
                    await handleGoToCoordinates(message);
                    return;
                }

                await handleGoToPlayer(afterGoTo);
                return;
            }

            if (
                normalized === 'come here' ||
                normalized === `come here ${this.name.toLowerCase()}` ||
                normalized === `come here please ${this.name.toLowerCase()}`
            ) {
                const player = this.bot.players[username]?.entity;
                if (!player) {
                    this.bot.chat('Could not find you.');
                    return;
                }

                try {
                    await skills.goToPosition(
                        this.bot,
                        player.position.x,
                        player.position.y,
                        player.position.z,
                        2
                    );
                    this.bot.chat('Arrived.');
                } catch (err) {
                    console.error('Come here failed:', err);
                    this.bot.chat('Could not get there.');
                }
                return;
            }

            if (serverProxy.getNumOtherAgents() > 0) return;

            try {
                await respondFunc(username, message);
            } catch (error) {
                console.error('Error handling chat:', error);
            }
        });

        if (save_data && save_data.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(
                save_data.self_prompt,
                save_data.self_prompting_state
            );
        }

        if (save_data && save_data.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: 'You have restarted and this message is auto-generated. Continue the conversation with me.',
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        } else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        } else {
            this.openChat('Hello world! I am ' + this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.clearControlStates();

        if (this.bot.collectBlock && typeof this.bot.collectBlock.stop === 'function') {
            this.bot.collectBlock.stop();
        }
        if (this.bot.pvp && typeof this.bot.pvp.stop === 'function') {
            this.bot.pvp.stop();
        }
        if (this.bot.ashfinder && typeof this.bot.ashfinder.stop === 'function') {
            this.bot.ashfinder.stop();
        }
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        this._responseFailureCount = 0;

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);

        const lowerMessage = String(message || '').toLowerCase();

        const user_command_name = (!self_prompt && !from_other_bot)
            ? containsCommand(message)
            : null;

        const urgentAdminTask =
            !self_prompt &&
            !from_other_bot &&
            !!user_command_name;
			
		if (urgentAdminTask) {
			console.log(`[Priority] Pausing self-prompting for forced command: ${message}`);

			if (this.self_prompter.isActive()) {
				this.self_prompter.stopLoop();
				this.self_prompter.pause();
			}

			this.actions.cancelResume();

			// THIS IS THE FIX
			if (!this.isIdle()) {
				console.log("[Priority] Interrupting current action and clearing queue...");

				await this.actions.stop(true); // THIS CLEARS THE QUEUE

				await new Promise(resolve => setTimeout(resolve, 300));
			}
		}

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
				console.log('[DEBUG] About to execute user command:', message);
console.log('[DEBUG] Bot entity exists:', !!this.bot?.entity);
console.log('[DEBUG] Bot username:', this.bot?.username);
console.log('[DEBUG] Time:', new Date().toISOString());
                let execute_res = await executeCommand(this, message);
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.prompt(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

				let execute_res = await executeCommand(this, res);

				console.log('Agent executed:', command_name, 'and got:', execute_res);
				used_command = true;

				const executeText = String(execute_res || '').toLowerCase();

				if (execute_res) {
					this.history.add('system', execute_res);
				} else {
					break;
				}

				// hard stop commands should end the loop immediately
				if (command_name === '!stop' || command_name === '!stfu') {
					break;
				}

				const softFailures = [
					'could not find',
					'invalid block type',
					'invalid item type',
					'failed',
					'unsafe to break',
					'i lost sight of you',
					'no nearby',
					'food is full',
					'does not exist',
					'was given 0 args',
					'requires 1 args',
					'requires 2 args',
					'no code block generated',
					'agent would not write code',
					'no response data'
				];

				if (softFailures.some(s => executeText.includes(s))) {
					this._responseFailureCount += 1;
					console.warn(`Soft failure ${this._responseFailureCount}/10`);

					if (this._responseFailureCount >= 10) {
						console.warn('Breaking response loop after repeated soft failures.');
						break;
					}
				} else {
					this._responseFailureCount = 0;
				}
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + ' ' + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {this.bot.chat(message);}
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
		this.bot.on('death', () => {
		this.actions.cancelResume();
		this.actions.stop();

		this.bot.clearControlStates();
		this.bot.interrupt_code = true;

		if (this.bot.ashfinder && typeof this.bot.ashfinder.stop === 'function') {
			this.bot.ashfinder.stop();
		}
	});
		this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);

                const pos = this.bot?.entity?.position;
                const safeX = pos && Number.isFinite(pos.x) ? pos.x : null;
                const safeY = pos && Number.isFinite(pos.y) ? pos.y : null;
                const safeZ = pos && Number.isFinite(pos.z) ? pos.z : null;

                if (safeX !== null && safeY !== null && safeZ !== null) {
                    this.memory_bank.rememberPlace('last_death_position', safeX, safeY, safeZ);
                }

                let death_pos_text = 'unknown';
                if (safeX !== null && safeY !== null && safeZ !== null) {
                    death_pos_text = `x: ${safeX.toFixed(2)}, y: ${safeY.toFixed(2)}, z: ${safeZ.toFixed(2)}`;
                }

                const dimension = this.bot.game.dimension;

				this.bot.clearControlStates();
				this.bot.interrupt_code = true;
				if (this.bot.ashfinder && typeof this.bot.ashfinder.stop === 'function') {
					this.bot.ashfinder.stop();
				}

                this.handleMessage(
                    'system',
                    `You died at position ${death_pos_text} in the ${dimension} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`
                );
            }        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            if (this.bot.ashfinder && typeof this.bot.ashfinder.stop === 'function') {
                this.bot.ashfinder.stop();
            } // clear any lingering baritone
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
        this.history.save();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
