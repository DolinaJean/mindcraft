import fs from 'fs';
import path from 'path';

const profilePath = path.resolve(process.cwd(), 'profiles', 'dingbat.json');

function loadProfile() {
  const raw = fs.readFileSync(profilePath, 'utf8');
  return JSON.parse(raw);
}

export function getModelForRole(role) {
  const profile = loadProfile();

  switch (role) {
    case 'planner':
      return profile.planner_model || profile.model || profile.code_model;
    case 'executor':
      return profile.executor_model || profile.model || profile.code_model;
    case 'coder':
      return profile.code_model || profile.model;
    case 'memory':
      return profile.memory_model || profile.model;
    case 'triage':
      return profile.triage_model || profile.memory_model || profile.model;
    case 'embed':
      return profile.embedding_model;
    default:
      return profile.model || profile.code_model;
  }
}

export function getPromptForRole(role) {
  const profile = loadProfile();

  switch (role) {
    case 'planner':
      return profile.conversing || '';
    case 'executor':
      return profile.executor_prompt || profile.coding || '';
    case 'coder':
      return profile.coding || '';
    case 'memory':
      return profile.saving_memory || '';
    case 'triage':
      return profile.bot_responder || '';
    case 'vision':
      return profile.image_analysis || '';
    default:
      return profile.conversing || '';
  }
}

export function getProfile() {
  return loadProfile();
}