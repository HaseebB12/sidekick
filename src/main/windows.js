'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');

/**
 * Three windows:
 *   companion — full-screen transparent, click-through overlay that the character lives in.
 *   chat      — the conversation panel, parked next to the character.
 *   settings  — ordinary (frameless) window.
 */

const R = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const P = (f) => path.join(__dirname, '..', 'preload', f);

let companion = null;
let chat = null;
let settings = null;

function primaryBounds() {
  return screen.getPrimaryDisplay().bounds;
}

/* ------------------------------------------------------------------ companion */

function createCompanion() {
  if (companion && !companion.isDestroyed()) return companion;
  const b = primaryBounds();

  companion = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never steal focus from whatever the user is actually working in.
    focusable: false,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: P('bridge.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Surface overlay-renderer problems in the main log. A transparent click-through
  // window shows nothing when its script dies, so without this it fails silently.
  companion.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log('[companion]', e.message);
  });
  companion.webContents.on('did-fail-load', (_e, code, desc) =>
    console.error('[companion] failed to load:', code, desc)
  );
  companion.webContents.on('preload-error', (_e, file, err) =>
    console.error('[companion] preload error:', file, err && err.message)
  );

  companion.setAlwaysOnTop(true, 'screen-saver');
  // Click-through by default; the renderer flips this off while the cursor is
  // actually over the figure or its toolbar.
  companion.setIgnoreMouseEvents(true, { forward: true });
  companion.loadFile(R('companion', 'index.html'));
  companion.on('closed', () => {
    companion = null;
  });

  // Keep the overlay glued to the primary display if resolution changes.
  const resize = () => {
    if (companion && !companion.isDestroyed()) companion.setBounds(primaryBounds());
  };
  screen.on('display-metrics-changed', resize);
  screen.on('display-added', resize);
  screen.on('display-removed', resize);

  return companion;
}

/* ----------------------------------------------------------------------- chat */

function createChat() {
  if (chat && !chat.isDestroyed()) return chat;

  chat = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 340,
    minHeight: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: P('bridge.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  chat.setAlwaysOnTop(true, 'screen-saver');
  chat.loadFile(R('chat', 'index.html'));
  chat.on('closed', () => {
    chat = null;
  });
  return chat;
}

/** Park the chat panel beside the character without letting it run off-screen. */
function placeChatNear(anchor) {
  if (!chat || chat.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const [w, h] = chat.getSize();
  const gap = 16;

  let x = Math.round(anchor.x + anchor.width + gap);
  if (x + w > work.x + work.width) x = Math.round(anchor.x - w - gap); // flip to the left
  x = Math.max(work.x + 8, Math.min(x, work.x + work.width - w - 8));

  let y = Math.round(anchor.y + anchor.height / 2 - h / 2);
  y = Math.max(work.y + 8, Math.min(y, work.y + work.height - h - 8));

  chat.setPosition(x, y);
}

/* ------------------------------------------------------------------- settings */

function createSettings() {
  if (settings && !settings.isDestroyed()) {
    settings.show();
    settings.focus();
    return settings;
  }

  settings = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 520,
    frame: false,
    backgroundColor: '#12121a',
    show: false,
    skipTaskbar: false,
    title: 'Sidekick — Settings',
    webPreferences: {
      preload: P('bridge.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settings.loadFile(R('settings', 'index.html'));
  settings.once('ready-to-show', () => {
    settings.show();
    settings.focus();
  });
  settings.on('closed', () => {
    settings = null;
  });
  return settings;
}

/* --------------------------------------------------------------------- shared */

const get = {
  companion: () => (companion && !companion.isDestroyed() ? companion : null),
  chat: () => (chat && !chat.isDestroyed() ? chat : null),
  settings: () => (settings && !settings.isDestroyed() ? settings : null),
};

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Hide every Sidekick surface, run `fn`, then put them back exactly as they were (F3).
 * The small delay gives the compositor time to actually clear the pixels.
 */
async function withOverlaysHidden(fn, settleMs = 180) {
  const wins = [get.companion(), get.chat()].filter((w) => w && w.isVisible());
  wins.forEach((w) => w.hide());
  await new Promise((r) => setTimeout(r, wins.length ? settleMs : 0));
  try {
    return await fn();
  } finally {
    wins.forEach((w) => w.showInactive());
  }
}

module.exports = {
  createCompanion,
  createChat,
  createSettings,
  placeChatNear,
  withOverlaysHidden,
  broadcast,
  get,
  primaryBounds,
};
