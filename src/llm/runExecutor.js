import { getPromptForRole, getProfile } from './modelRouter.js';
import { callModel } from './callModel.js';
import { safeCommand } from '../agent/commandValidator.js';

export async function runExecutor({
  memory = '',
  stats = '',
  inventory = '',
  commandDocs = '',
  task = ''
}) {
  const profile = getProfile();
  let prompt = getPromptForRole('executor');

  prompt = prompt
    .replaceAll('$NAME', profile.name || 'bot')
    .replaceAll('$MEMORY', memory)
    .replaceAll('$STATS', stats)
    .replaceAll('$INVENTORY', inventory)
    .replaceAll('$COMMAND_DOCS', commandDocs)
    .replaceAll('$TO_SUMMARIZE', task);

  prompt += `\n\nTask:\n${task}\n`;

  const raw = await callModel('executor', prompt, profile.api_endpoint);
  return safeCommand(raw);
}