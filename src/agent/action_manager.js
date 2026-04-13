// ./src/agent/action_manager.js
// Goal: normal commands wait their turn instead of interrupting each other.
// Notes:
// - User actions are queued by default.
// - Mode actions do NOT interrupt active user actions and do NOT pile up in the queue.
// - Resume actions still work.
// - Force-stop behavior is still available through stop().

export class ActionManager {
    constructor(agent) {
        this.agent = agent;

        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionFn = null;

        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';

        this.last_action_time = 0;
        this.recent_action_counter = 0;

        // New: queued actions wait their turn instead of interrupting.
        this.pendingActions = [];
        this.processingQueue = false;
    }

    async resumeAction(actionFn, timeout) {
        return this._executeResume(actionFn, timeout);
    }

    async runAction(actionLabel, actionFn, { timeout = 10, resume = false, interrupt = false } = {}) {
        if (resume) {
            return this._executeResume(actionLabel, actionFn, timeout);
        }

        // Emergency actions can still interrupt.
        if (interrupt) {
            return this._executeAction(actionLabel, actionFn, timeout, true);
        }

        // If the exact same action is already running, do not queue another copy.
        if (this.executing && this.currentActionLabel === actionLabel) {
            return {
                success: false,
                message: `${actionLabel} is already running.`,
                interrupted: false,
                timedout: false,
                queued: false
            };
        }

        // If something is already running, queue normal user actions.
        if (this.executing) {
            const isModeAction = typeof actionLabel === 'string' && actionLabel.startsWith('mode:');

            // Modes should never interrupt a running action and should not pile up.
            if (isModeAction) {
                return {
                    success: false,
                    message: `Skipped ${actionLabel} because ${this.currentActionLabel} is already running.`,
                    interrupted: false,
                    timedout: false,
                    queued: false
                };
            }

            // Avoid duplicate queued commands of the same label.
            const alreadyQueued = this.pendingActions.some(item => item.actionLabel === actionLabel);
            if (alreadyQueued) {
                return {
                    success: false,
                    message: `${actionLabel} is already queued.`,
                    interrupted: false,
                    timedout: false,
                    queued: true
                };
            }

            return await new Promise((resolve, reject) => {
                this.pendingActions.push({
                    actionLabel,
                    actionFn,
                    timeout,
                    resolve,
                    reject
                });
                console.log(`queued action "${actionLabel}" behind "${this.currentActionLabel}"`);
            });
        }

        return this._executeAction(actionLabel, actionFn, timeout, false);
    }

    async stop(clearQueue = false) {
        if (clearQueue) {
            while (this.pendingActions.length > 0) {
                const queued = this.pendingActions.shift();
                queued.resolve({
                    success: false,
                    message: 'Queued action cancelled by stop.',
                    interrupted: true,
                    timedout: false,
                    queued: false
                });
            }
        }

        if (!this.executing) return;

        const timeout = setTimeout(() => {
            this.agent.cleanKill('Code execution refused stop after 10 seconds. Killing process.');
        }, 10000);

        while (this.executing) {
            this.agent.requestInterrupt();
            console.log('waiting for code to finish executing...');
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        clearTimeout(timeout);
    }

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10) {
        const newResume = actionFn != null;

        if (newResume) {
            this.resume_func = actionFn;
            if (actionLabel == null) {
                throw new Error('actionLabel is required for new resume');
            }
            this.resume_name = actionLabel;
        }

        if (
            this.resume_func != null &&
            (this.agent.isIdle() || newResume) &&
            (!this.agent.self_prompter.isActive() || newResume)
        ) {
            this.currentActionLabel = this.resume_name;
            const res = await this._executeAction(this.resume_name, this.resume_func, timeout, false);
            this.currentActionLabel = '';
            return res;
        }

        return { success: false, message: null, interrupted: false, timedout: false };
    }

    async _executeAction(actionLabel, actionFn, timeout = 10, forceInterrupt = false) {
        let TIMEOUT;

        try {
            if (this.last_action_time > 0) {
                const timeDiff = Date.now() - this.last_action_time;
                if (timeDiff < 20) {
                    this.recent_action_counter++;
                } else {
                    this.recent_action_counter = 0;
                }

                if (this.recent_action_counter > 3) {
                    console.warn('Fast action loop detected, cancelling resume.');
                    this.cancelResume();
                }
                if (this.recent_action_counter > 5) {
                    console.error('Infinite action loop detected, shutting down.');
                    this.agent.cleanKill('Infinite action loop detected, shutting down.');
                    return {
                        success: false,
                        message: 'Infinite action loop detected, shutting down.',
                        interrupted: false,
                        timedout: false
                    };
                }
            }

            this.last_action_time = Date.now();
            console.log('executing code...\n');

            // In the new design, only explicit interrupt actions should stop a running action.
            if (this.executing) {
                if (!forceInterrupt) {
                    return {
                        success: false,
                        message: `${actionLabel} could not start because ${this.currentActionLabel} is already running.`,
                        interrupted: false,
                        timedout: false
                    };
                }

                console.log(`action \"${actionLabel}\" trying to interrupt current action \"${this.currentActionLabel}\"`);
                await this.stop();
            }

            this.agent.clearBotLogs();
            this.executing = true;
            this.currentActionLabel = actionLabel;
            this.currentActionFn = actionFn;
            this.timedout = false;

            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            await actionFn();

            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);

            const output = this.getBotOutputSummary();
            const interrupted = this.agent.bot.interrupt_code;
            const timedout = this.timedout;
            this.agent.clearBotLogs();

            if (!interrupted) {
                this.agent.bot.emit('idle');
            }

            const result = { success: true, message: output, interrupted, timedout };
            await this._drainQueue();
            return result;
        } catch (err) {
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();

            console.error('Code execution triggered catch:', err);
            console.error(err.stack);

            const errorString = err?.toString?.() || String(err);
            const stackString = err?.stack || 'No stack available';

            const message =
                this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + errorString + '\n' +
                'Stack trace:\n' + stackString + '\n';

            const interrupted = this.agent.bot.interrupt_code;
            this.agent.clearBotLogs();

            if (!interrupted) {
                this.agent.bot.emit('idle');
            }

            const result = { success: false, message, interrupted, timedout: false };
            await this._drainQueue();
            return result;
        }
    }

    async _drainQueue() {
        if (this.processingQueue) return;
        if (this.executing) return;
        if (this.pendingActions.length === 0) return;

        this.processingQueue = true;
        try {
            while (!this.executing && this.pendingActions.length > 0) {
                const next = this.pendingActions.shift();
                try {
                    const result = await this._executeAction(next.actionLabel, next.actionFn, next.timeout, false);
                    next.resolve(result);
                } catch (err) {
                    next.reject(err);
                }
            }
        } finally {
            this.processingQueue = false;
        }
    }

    getBotOutputSummary() {
        const { bot } = this.agent;
        if (bot.interrupt_code && !this.timedout) return '';

        let output = bot.output;
        const MAX_OUT = 500;

        if (output.length > MAX_OUT) {
            output = `Action output is very long (${output.length} chars) and has been shortened.\n\nFirst outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n${output.substring(output.length - MAX_OUT / 2)}`;
        } else {
            output = 'Action output:\n' + output.toString();
        }

        bot.output = '';
        return output;
    }

    _startTimeout(TIMEOUT_MINS = 10) {
        return setTimeout(async () => {
            console.warn(`Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            await this.stop();
        }, TIMEOUT_MINS * 60 * 1000);
    }
}
