import { getPromptForRole, getProfile } from './modelRouter.js';
import { callModel } from './callModel.js';

export async function runPlanner({
  memory = '',
  stats = '',
  inventory = '',
  commandDocs = '',
  conversation = ''
}) {
  const profile = getProfile();
  let prompt = getPromptForRole('planner');

  prompt = prompt
    .replaceAll('$NAME', profile.name || 'bot')
    .replaceAll('$MEMORY', memory)
    .replaceAll('$STATS', stats)
    .replaceAll('$INVENTORY', inventory)
    .replaceAll('$COMMAND_DOCS', commandDocs);

  prompt += `\n\nLatest request:\n${conversation}\n`;
  prompt += `\nDecide the single best next subtask in plain text.\n`;

  const raw = await callModel('planner', prompt, profile.api_endpoint);
  return raw.trim();
}