'use strict';

/**
 * Single source of truth for settings shape + defaults.
 * Used by the main process store and echoed to renderers over IPC.
 */

const DEFAULT_SETTINGS = {
  // --- AI (F4, F7) ---
  apiKey: '',
  model: 'gemini-2.0-flash',

  // --- Input (F1, F7) ---
  hotkey: 'Control+Shift+Space',

  // --- Presence (F2, F7) ---
  liveliness: 'calm', // 'calm' | 'playful' | 'off'
  keepOnDesktop: false, // D3: default is summon-then-rest
  webLine: true,
  reducedMotion: false, // app-level override; OS setting is honoured separately
  scale: 1, // character size multiplier

  // --- Identity (F5, F6) ---
  activeCharacter: 'pip',

  // Per-character state (F6, F8): { [id]: { hue, saturation, parts: {partName: color}, position: {x,y} } }
  characters: {},

  // --- Conversation (D8, F8) ---
  rememberConversation: false, // default: fresh conversation each summon
};

const CHARACTER_DEFAULTS = {
  hue: 0,
  saturation: 100,
  brightness: 100,
  parts: {},
  position: null, // null = "pick a sensible spot on summon"
};

const SYSTEM_INSTRUCTION = [
  'You are Sidekick, a desktop AI companion that can see the user\'s screen.',
  'The attached image is a screenshot of what the user is looking at right now.',
  'Read errors, code, UI, forms and text in the screenshot and answer about them directly.',
  'Be concise. Lead with the answer, then give short numbered steps when a fix is needed.',
  'Use fenced code blocks for code, commands and file paths.',
  'If the screenshot does not contain what you would need, say exactly what is missing',
  'and suggest the user hit Re-capture on the right screen.',
  'Never invent UI elements or error text that is not visible in the image.',
].join(' ');

module.exports = { DEFAULT_SETTINGS, CHARACTER_DEFAULTS, SYSTEM_INSTRUCTION };
