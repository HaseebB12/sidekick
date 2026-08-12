'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, shell } = require('electron');

/**
 * Character catalogue (F5).
 *
 *  - Built-ins live in assets/characters and are SVGs with `data-part` attributes,
 *    which is what makes per-part recolour possible (F6 / D2).
 *  - User characters are *any* image dropped into <userData>/characters. Those only
 *    get hue/tint recolour, and they glide rather than walk (D5).
 */

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function builtinDir() {
  return path.join(__dirname, '..', '..', 'assets', 'characters');
}

function userDir() {
  const dir = path.join(app.getPath('userData'), 'characters');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'READ ME.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        [
          'Sidekick — your characters folder',
          '',
          'Drop any image in here and it shows up in the character picker:',
          '  PNG, JPG, GIF, WEBP, SVG',
          '',
          'Tips',
          '  - A transparent PNG looks best (no white box around your figure).',
          '  - Roughly square, 300-800px, is the sweet spot.',
          '  - The file name becomes the character name.',
          '  - Photos swing and glide, they do not walk - only the built-in',
          '    characters have real animation frames.',
          '',
          'The picker refreshes on its own when you add a file.',
        ].join('\r\n'),
        'utf8'
      );
    }
  } catch (err) {
    console.error('[characters] cannot prepare user folder:', err.message);
  }
  return dir;
}

function prettify(basename) {
  return basename
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Hand-rolling this encoded the Windows drive letter too ("C:" -> "C%3A"), which
 * Chromium refuses to load, so every character thumbnail came out broken.
 * pathToFileURL gets the drive letter, spaces and unicode right.
 */
function toFileUrl(p) {
  return pathToFileURL(p).href;
}

function readDir(dir, source) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const full = path.join(dir, e.name);
      const ext = path.extname(e.name).toLowerCase();
      const id = `${source}:${path.basename(e.name, ext)}`;
      return {
        id: source === 'builtin' ? path.basename(e.name, ext) : id,
        name: prettify(path.basename(e.name, ext)),
        source,
        ext,
        path: full,
        url: toFileUrl(full),
        // Only inline SVGs expose named parts, so only they get per-part recolour.
        vector: ext === '.svg',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function list() {
  return [...readDir(builtinDir(), 'builtin'), ...readDir(userDir(), 'user')];
}

function find(id) {
  return list().find((c) => c.id === id) || null;
}

/** Inline SVG markup, so the renderer can recolour individual `data-part` nodes. */
function svgMarkup(id) {
  const c = find(id);
  if (!c || !c.vector) return null;
  try {
    return fs.readFileSync(c.path, 'utf8');
  } catch {
    return null;
  }
}

function openFolder() {
  return shell.openPath(userDir());
}

/**
 * Copy chosen images into the characters folder (F5). Used by both the
 * "Add character image…" picker and drag-and-drop onto the settings window,
 * so users never have to go hunting for the folder themselves.
 */
function importFiles(paths = []) {
  const dir = userDir();
  const added = [];
  const skipped = [];

  for (const src of paths) {
    const ext = path.extname(src).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      skipped.push(path.basename(src));
      continue;
    }
    const base = path.basename(src, ext);
    let target = path.join(dir, base + ext);
    let n = 2;
    while (fs.existsSync(target)) {
      target = path.join(dir, `${base} ${n}${ext}`);
      n += 1;
    }
    try {
      fs.copyFileSync(src, target);
      added.push(prettify(path.basename(target, ext)));
    } catch (err) {
      skipped.push(`${path.basename(src)} (${err.code || err.message})`);
    }
  }
  return { added, skipped };
}

/** Delete one of the user's own characters. Built-ins are never removable. */
function remove(id) {
  const c = find(id);
  if (!c) throw new Error('That character no longer exists.');
  if (c.source !== 'user') throw new Error('Built-in characters cannot be deleted.');
  fs.unlinkSync(c.path);
  return true;
}

/** Fires `onChange` (debounced) whenever the user drops/removes a character. */
function watch(onChange) {
  let timer = null;
  try {
    const watcher = fs.watch(userDir(), { persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 300);
    });
    return () => watcher.close();
  } catch (err) {
    console.error('[characters] watch unavailable:', err.message);
    return () => {};
  }
}

module.exports = { list, find, svgMarkup, openFolder, importFiles, remove, watch, userDir };
