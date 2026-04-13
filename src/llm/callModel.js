import { getModelForRole } from './modelRouter.js';

export async function callModel(role, prompt, apiEndpoint = 'http://localhost:11434') {
  const model = getModelForRole(role);

  const response = await fetch(`${apiEndpoint}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Model call failed for role "${role}": ${response.status} ${text}`);
  }

  const data = await response.json();
  return (data.response || '').trim();
}