const COMMAND_PATTERNS = [
  /^!stop$/,
  /^!goToSurface$/,
  /^!moveTo\((-?\d+),\s*(-?\d+),\s*(-?\d+)\)$/,
  /^!follow\(([A-Za-z0-9_]+)\)$/,
  /^!followPlayer\("?[A-Za-z0-9_]+"?,\s*\d+\)$/,
  /^!mineBlock\("?[A-Za-z0-9_:.-]+"?,\s*\d+\)$/,
  /^!placeBlock\("?[A-Za-z0-9_:.-]+"?,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\)$/,
  /^!wait$/,
  /^!wait\(\d+\)$/
];

export function validateCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const cleaned = text.trim();
  return COMMAND_PATTERNS.some((rx) => rx.test(cleaned));
}

export function safeCommand(text) {
  const cleaned = (text || '').trim();
  return validateCommand(cleaned) ? cleaned : '!stop';
}