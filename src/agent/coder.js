// ./src/agent/coder.js

import { writeFile, readFile, mkdirSync } from 'fs';
import { makeCompartment, lockdown } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import {ESLint} from "eslint";

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/'+agent.name+'/action-code/';
        this.code_template = '';
        this.code_lint_template = '';

        readFile('./bots/execTemplate.js', 'utf8', (err, data) => {
            if (err) throw err;
            this.code_template = data;
        });
        readFile('./bots/lintTemplate.js', 'utf8', (err, data) => {
            if (err) throw err;
            this.code_lint_template = data;
        });
        mkdirSync('.' + this.fp, { recursive: true });
    }

    async generateCode(agent_history) {
        this.agent.bot.modes.pause('unstuck');
        lockdown();

        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory();

        messages.push({
            role: 'system',
			content: `
You are Dingbat writing executable JavaScript for a Minecraft Mindcraft bot built on Mineflayer.

You MUST:
- Return exactly ONE JavaScript code block using triple backticks
- Do NOT include any text before or after the code block
- Do NOT explain anything
- Only output runnable code
- Output only the BODY of the action code
- Do NOT write export statements
- Do NOT define function main(...)
- Do NOT wrap code in async functions
- The runtime already provides the execution wrapper

You have access to:
- skills.*
- world.*
- Vec3
- bot

CRITICAL API RULES:
- You may ONLY call functions that actually exist in the provided skill and world docs
- Do NOT invent helpers such as skills.findAndCraft
- If a helper does not exist, combine existing skills.* calls instead
- Prefer existing skills.* helpers over raw custom logic
- If you are unsure whether a function exists, do not use it

GENERAL RULES:
- Prefer safe, incremental actions over ambitious plans
- Observe the environment and inventory before acting
- If pathfinding or movement helpers already exist, use them instead of reinventing movement
- If a task requires placement, first ensure there is a safe place to stand and place blocks

SURVIVAL RULES:
- If the bot is in a dangerous or unstable position, stabilize first
- Do NOT attempt crafting or building if there is no safe place to stand or place blocks
- If descending is unsafe, create a safe platform first
- Avoid falls, lava, drowning, suffocation, and unnecessary combat
- Do not break support blocks unless a safe landing or escape path exists

TASK RULES:
- For multi-step tasks, do the smallest safe next step that makes progress
- If a crafting table or other workstation is required, first create or reach a safe working area
- If the task cannot be completed safely, write code that stabilizes the bot and logs the blocker
- Use only documented functions from $CODE_DOCS

STORAGE RULES:
- To stash excess inventory in a chest, prefer skills.stashInventoryInNearbyChest(bot).
- Do NOT invent chest helpers like skills.takeFromInventory, skills.depositIntoChest, or world.findNearestEntityByName.
- Do NOT manipulate chest storage manually if a high-level stash helper already exists.
- If asked to empty or stash inventory, use skills.stashInventoryInNearbyChest(bot) directly.

CRAFTING AND EQUIPMENT RULES:
- To obtain materials before crafting, prefer skills.ensureItem(bot, "item_name", count) when available.
- Use skills.craftRecipe(bot, "item_name", count) to craft items.
- Do NOT pass ingredient arrays or recipe grids to skills.craftRecipe.
- Use skills.equip(bot, "item_name") to equip armor, tools, weapons, or shields.
- Do NOT pass slot numbers to skills.equip.
- skills.craftRecipe may automatically use or place a crafting table if needed.
- For armor tasks, prefer high-level armor helpers if they exist.
- A full armor set is helmet, chestplate, leggings, and boots.
- Diamond armor requires 24 diamonds total.
- Netherite armor requires diamond armor pieces plus netherite ingots.

RESOURCE ACQUISITION RULES:
- To obtain materials before crafting, prefer skills.ensureItem(bot, "item_name", count) when available.
- Before crafting, check whether required materials are already in inventory.
- If materials are missing, gather them before attempting to craft.
- Prefer high-level gathering helpers when available.
- For armor tasks, if the bot lacks enough materials, gather the required materials first, then craft and equip.
- For diamond armor, 24 diamonds are required.
- Use existing movement, mining, and navigation helpers instead of inventing new pathfinding APIs.
- In this project, prefer existing Mindcraft skills and Ashfinder-compatible helpers when available.

Always produce valid working code. No exceptions.

Example format:
\`\`\`javascript
await skills.goToSurface(bot);
\`\`\`
`
        });

        const MAX_ATTEMPTS = 5;
        const MAX_NO_CODE = 3;

        let code = null;
        let no_code_failures = 0;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code) {
                return null;
            }

            const messages_copy = JSON.parse(JSON.stringify(messages));

            let systemPrompt = `
You are Dingbat writing executable JavaScript for a Minecraft Mindcraft bot built on Mineflayer.

You MUST:
- Return exactly ONE JavaScript code block using triple backticks
- Do NOT include any text before or after the code block
- Do NOT explain anything
- Only output runnable code
- Output only the BODY of the action code
- Do NOT write export statements
- Do NOT define function main(...)
- Do NOT wrap code in async functions
- The runtime already provides the execution wrapper

You have access to:
- skills.*
- world.*
- Vec3
- bot

CRITICAL API RULES:
- You may ONLY call functions that actually exist in the provided skill and world docs
- Do NOT invent helpers such as skills.findAndCraft
- If a helper does not exist, combine existing skills.* calls instead
- Prefer existing skills.* helpers over raw custom logic
- If you are unsure whether a function exists, do not use it

GENERAL RULES:
- Prefer safe, incremental actions over ambitious plans
- Observe the environment and inventory before acting
- If pathfinding or movement helpers already exist, use them instead of reinventing movement
- If a task requires placement, first ensure there is a safe place to stand and place blocks

SURVIVAL RULES:
- If the bot is in a dangerous or unstable position, stabilize first
- Do NOT attempt crafting or building if there is no safe place to stand or place blocks
- If descending is unsafe, create a safe platform first
- Avoid falls, lava, drowning, suffocation, and unnecessary combat
- Do not break support blocks unless a safe landing or escape path exists

TASK RULES:
- For multi-step tasks, do the smallest safe next step that makes progress
- If a crafting table or other workstation is required, first create or reach a safe working area
- If the task cannot be completed safely, write code that stabilizes the bot and logs the blocker

STORAGE RULES:
- To stash excess inventory in a chest, prefer skills.stashInventoryInNearbyChest(bot).
- Do NOT invent chest helpers like skills.takeFromInventory, skills.depositIntoChest, or world.findNearestEntityByName.
- Do NOT manipulate chest storage manually if a high-level stash helper already exists.
- If asked to empty or stash inventory, use skills.stashInventoryInNearbyChest(bot) directly.

CRAFTING AND EQUIPMENT RULES:
- To obtain materials before crafting, prefer skills.ensureItem(bot, "item_name", count) when available.
- Use skills.craftRecipe(bot, "item_name", count) to craft items.
- Do NOT pass ingredient arrays or recipe grids to skills.craftRecipe.
- Use skills.equip(bot, "item_name") to equip armor, tools, weapons, or shields.
- Do NOT pass slot numbers to skills.equip.
- skills.craftRecipe may automatically use or place a crafting table if needed.
- For armor tasks, prefer high-level armor helpers if they exist.
- A full armor set is helmet, chestplate, leggings, and boots.
- Diamond armor requires 24 diamonds total.
- Netherite armor requires diamond armor pieces plus netherite ingots.

RESOURCE ACQUISITION RULES:
- To obtain materials before crafting, prefer skills.ensureItem(bot, "item_name", count) when available.
- Before crafting, check whether required materials are already in inventory.
- If materials are missing, gather them before attempting to craft.
- Prefer high-level gathering helpers when available.
- For armor tasks, if the bot lacks enough materials, gather the required materials first, then craft and equip.
- For diamond armor, 24 diamonds are required.
- Use existing movement, mining, and navigation helpers instead of inventing new pathfinding APIs.
- In this project, prefer existing Mindcraft skills and Ashfinder-compatible helpers when available.

$CODE_DOCS

Always produce valid working code. No exceptions.

Example format:
\`\`\`javascript
await skills.goToSurface(bot);
\`\`\`
`;

            systemPrompt = await this.agent.prompter.replaceStrings(systemPrompt, messages_copy, this.agent.prompter.coding_examples);

            let res = await this.agent.prompter.code_model.sendRequest(messages_copy, systemPrompt);
            res = String(res || '').trim();

            if (this.agent.bot.interrupt_code) {
                return null;
            }

            const contains_code = res.includes('```');

            if (!contains_code) {
                if (res.includes('!newAction')) {
                    messages.push({
                        role: 'assistant',
                        content: res.substring(0, res.indexOf('!newAction'))
                    });
                    continue;
                }

                if (no_code_failures >= MAX_NO_CODE) {
                    console.warn('Action failed, agent would not write code.');
                    return 'Action failed, agent would not write code.';
                }

                messages.push({
                    role: 'system',
                    content: 'Error: no code provided. Return exactly one JavaScript code block using triple backticks and nothing else.'
                });

                console.warn('No code block generated. Trying again.');
                no_code_failures++;
                continue;
            }

            code = res.substring(res.indexOf('```') + 3, res.lastIndexOf('```')).trim();

            if (code.toLowerCase().startsWith('javascript')) {
                code = code.substring('javascript'.length).trim();
            } else if (code.toLowerCase().startsWith('js')) {
                code = code.substring('js'.length).trim();
            }

            const result = await this._stageCode(code);
            const executionModule = result.func;
            const lintResult = await this._lintCode(result.src_lint_copy);

            if (lintResult) {
                const message = 'Error: Code lint error:\n' + lintResult + '\nPlease try again.';
                console.warn('Linting error:\n' + lintResult + '\n');
                messages.push({ role: 'system', content: message });
                continue;
            }

            if (!executionModule) {
                console.warn('Failed to stage code, something is wrong.');
                return 'Failed to stage code, something is wrong.';
            }

            try {
                console.log('Executing code...');
                await executionModule.main(this.agent.bot);

                const code_output = this.agent.actions.getBotOutputSummary();
                const summary = "Agent wrote this code:\n```" + this._sanitizeCode(code) + "```\nCode Output:\n" + code_output;
                return summary;
            } catch (e) {
                if (this.agent.bot.interrupt_code) {
                    return null;
                }

                console.warn('Generated code threw error: ' + e.toString());
                console.warn('trying again...');

                const code_output = this.agent.actions.getBotOutputSummary();

                messages.push({
                    role: 'assistant',
                    content: res
                });

                messages.push({
                    role: 'system',
                    content:
                        'The previous code failed.\n' +
                        'Error: ' + e.toString() + '\n' +
                        'Code output:\n' + code_output + '\n' +
                        'Return exactly one corrected JavaScript code block and nothing else.'
                });
            }
        }

        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }
    
    async  _lintCode(code) {
        let result = '#### CODE ERROR INFO ###\n';
        const codeNoComments = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const skillRegex = /((?:skills|world)\.(.*?))\(/g;
        const skills = [];
        let match;
        while ((match = skillRegex.exec(codeNoComments)) !== null) {
            skills.push(match[1]);
        }
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        const docList = Array.isArray(allDocs) ? allDocs : [String(allDocs || '')];

        const knownSkills = docList
            .map(doc => String(doc).split('\n')[0].trim())
            .filter(Boolean);

        const knownSkillSet = new Set(knownSkills);

        const missingSkills = skills.filter(skill => !knownSkillSet.has(skill));

        function nearestMatches(target, options, limit = 5) {
            const t = target.toLowerCase();

            const scored = options.map(option => {
                const o = option.toLowerCase();

                let score = 0;
                if (o === t) score += 100;
                if (o.includes(t) || t.includes(o)) score += 50;

                const targetParts = t.split('.');
                const optionParts = o.split('.');
                const targetName = targetParts[targetParts.length - 1];
                const optionName = optionParts[optionParts.length - 1];

                if (optionName === targetName) score += 40;
                if (optionName.includes(targetName) || targetName.includes(optionName)) score += 20;

                let overlap = 0;
                for (const ch of targetName) {
                    if (optionName.includes(ch)) overlap++;
                }
                score += overlap;

                return { option, score };
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map(x => x.option);
        }

        if (missingSkills.length > 0) {
            result += 'These functions do not exist:\n';
            result += missingSkills.join('\n');

            result += '\n\nClosest valid functions:\n';
            for (const missing of missingSkills) {
                const suggestions = nearestMatches(missing, knownSkills, 3);
                result += `${missing} -> ${suggestions.join(', ')}\n`;
            }

            console.log(result);
            return result;
        }
		
        // Only reject explicit export statements in generated code.
        // Do not reject "main(...)" here because the lint template itself may contain that wrapper.
        if (/\bexport\s+/.test(codeNoComments)) {
            result += "#ERROR 1\n";
            result += "Message: Do not use export statements in generated action code.\n";
            result += "The code contains exceptions and cannot continue execution.";
            return result;
        }
		
        const eslint = new ESLint();
        const results = await eslint.lintText(code);
        const codeLines = code.split('\n');
        const exceptions = results.map(r => r.messages).flat();

        if (exceptions.length > 0) {
            exceptions.forEach((exc, index) => {
                if (exc.line && exc.column ) {
                    const errorLine = codeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                    result += `#ERROR ${index + 1}\n`;
                    result += `Message: ${exc.message}\n`;
                    result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                    result += `Related Code Line: ${errorLine}\n`;
                }
            });
            result += 'The code contains exceptions and cannot continue execution.';
        } else {
            return null;//no error
        }

        return result ;
    }
    // write custom code to file and import it
    // write custom code to file and prepare for evaluation
    async _stageCode(code) {
        code = this._sanitizeCode(code);
        let src = '';
        code = code.replaceAll('console.log(', 'log(bot,');
        code = code.replaceAll('log("', 'log(bot,"');

        console.log(`Generated code: """${code}"""`);

        // this may cause problems in callback functions
        code = code.replaceAll(';\n', '; if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}\n');
        for (let line of code.split('\n')) {
            src += `    ${line}\n`;
        }
        let src_lint_copy = this.code_lint_template.replace('/* CODE HERE */', src);
        src = this.code_template.replace('/* CODE HERE */', src);

        let filename = this.file_counter + '.js';
        // if (this.file_counter > 0) {
        //     let prev_filename = this.fp + (this.file_counter-1) + '.js';
        //     unlink(prev_filename, (err) => {
        //         console.log("deleted file " + prev_filename);
        //         if (err) console.error(err);
        //     });
        // } commented for now, useful to keep files for debugging
        this.file_counter++;
        
        let write_result = await this._writeFilePromise('.' + this.fp + filename, src);
        // This is where we determine the environment the agent's code should be exposed to.
        // It will only have access to these things, (in addition to basic javascript objects like Array, Object, etc.)
        // Note that the code may be able to modify the exposed objects.
        const compartment = makeCompartment({
            skills,
            log: skills.log,
            world,
            Vec3,
            agent: this.agent
        });
        const mainFn = compartment.evaluate(src);
        
        if (write_result) {
            console.error('Error writing code execution file: ' + write_result);
            return null;
        }
        return { func:{main: mainFn}, src_lint_copy: src_lint_copy };
    }

    _sanitizeCode(code) {
        code = code.trim();
        const remove_strs = ['Javascript', 'javascript', 'js']
        for (let r of remove_strs) {
            if (code.startsWith(r)) {
                code = code.slice(r.length);
                return code;
            }
        }
        return code;
    }

    _writeFilePromise(filename, src) {
        // makes it so we can await this function
        return new Promise((resolve, reject) => {
            writeFile(filename, src, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}