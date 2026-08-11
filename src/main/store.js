'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_SETTINGS, CHARACTER_DEFAULTS } = require('../shared/defaults');

/**
 * Dead-simple JSON store in userData. Everything stays on-device (constraint §8).
 * Writes are debounced so dragging the character doesn't hammer the disk.
 */

let settingsPath = null;
let cache = null;
let writeTimer = null;

function file() {
  if (!settingsPath) settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return settingsPath;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULT_SETTINGS, ...parsed };
    cache.characters = parsed.characters && typeof parsed.characters === 'object' ? parsed.characters : {};
  } catch {
    cache = { ...DEFAULT_SETTINGS, characters: {} };
  }
  return cache;
}

function flush() {
  writeTimer = null;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] failed to persist settings:', err.message);
  }
}

function schedule() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 250);
}

function getAll() {
  return JSON.parse(JSON.stringify(load()));
}

function get(key) {
  return load()[key];
}

function set(patch) {
  const s = load();
  Object.assign(s, patch);
  schedule();
  return getAll();
}

/** Per-character colour + position (F6, F8). */
function getCharacterState(id) {
  const s = load();
  return { ...CHARACTER_DEFAULTS, ...(s.characters[id] || {}) };
}

function setCharacterState(id, patch) {
  const s = load();
  const next = { ...CHARACTER_DEFAULTS, ...(s.characters[id] || {}), ...patch };
  s.characters[id] = next;
  schedule();
  return next;
}

function flushNow() {
  if (writeTimer) clearTimeout(writeTimer);
  flush();
}

/** Back to factory defaults. Characters on disk are left alone — only state is cleared. */
function reset() {
  cache = { ...DEFAULT_SETTINGS, characters: {} };
  flushNow();
  return getAll();
}

module.exports = { getAll, get, set, getCharacterState, setCharacterState, reset, flushNow };
