'use strict';

const { app, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');

const store = require('./store');
const characters = require('./characters');
const { capturePrimaryDisplay } = require('./capture');
const gemini = require('./gemini');
const W = require('./windows');

/* Single instance: a second launch just summons the existing one. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => summon('second-instance'));
}

if (process.platform === 'win32') app.setAppUserModelId('com.abdulhye.sidekick');

let visible = false;
let stopWatchingCharacters = null;

/* ------------------------------------------------------------ summon/dismiss */

function cursorPoint() {
  try {
    return screen.getCursorScreenPoint();
  } catch {
    const b = W.primaryBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
}

function summon(reason = 'hotkey') {
  const c = W.createCompanion();
  if (!c) return;
  if (!c.isVisible()) c.showInactive();
  c.setAlwaysOnTop(true, 'screen-saver');
  visible = true;
  c.webContents.send('summon', { reason, cursor: cursorPoint() });
  registerEscape();
}

function dismiss(reason = 'hotkey') {
  const c = W.get.companion();
  const chat = W.get.chat();
  if (chat) chat.hide();
  if (c) c.webContents.send('dismiss', { reason });
  visible = false;
  unregisterEscape();

  // Give the swing-out animation a beat before actually hiding the window,
  // unless the user wants a permanent desktop pet (D3 / F1).
  setTimeout(() => {
    if (visible) return;
    if (store.get('keepOnDesktop')) {
      if (c) c.showInactive();
      visible = true;
      return;
    }
    if (c) c.hide();
  }, 450);
}

function toggle() {
  if (visible && !store.get('keepOnDesktop')) dismiss('hotkey');
  else summon('hotkey');
}

/* --------------------------------------------------------------- keybindings */

let currentHotkey = null;
let escapeRegistered = false;

function registerHotkey(accelerator) {
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey);
    currentHotkey = null;
  }
  const wanted = accelerator || 'Control+Shift+Space';
  try {
    if (globalShortcut.register(wanted, toggle)) {
      currentHotkey = wanted;
      return { ok: true, hotkey: wanted };
    }
  } catch (err) {
    return { ok: false, hotkey: null, error: err.message };
  }
  return { ok: false, hotkey: null, error: `Windows would not give us ${wanted} — another app probably owns it.` };
}

// Esc only steals the key while the companion is actually on screen (F1).
function registerEscape() {
  if (escapeRegistered) return;
  escapeRegistered = globalShortcut.register('Escape', () => dismiss('escape'));
}

function unregisterEscape() {
  if (!escapeRegistered) return;
  globalShortcut.unregister('Escape');
  escapeRegistered = false;
}

/* ----------------------------------------------------------------------- IPC */

function wireIpc() {
  ipcMain.handle('settings:get', () => store.getAll());

  ipcMain.handle('settings:set', (_e, patch = {}) => {
    const before = store.getAll();
    const next = store.set(patch);
    if (patch.hotkey && patch.hotkey !== before.hotkey) {
      const res = registerHotkey(patch.hotkey);
      if (!res.ok) {
        store.set({ hotkey: before.hotkey });
        registerHotkey(before.hotkey);
        throw new Error(res.error);
      }
    }
    if ('keepOnDesktop' in patch && patch.keepOnDesktop !== before.keepOnDesktop) {
      if (patch.keepOnDesktop) summon('always-on');
      else dismiss('always-off');
    }
    W.broadcast('settings:changed', store.getAll());
    return next;
  });

  ipcMain.handle('characters:list', () => characters.list());
  ipcMain.handle('characters:svg', (_e, id) => characters.svgMarkup(id));
  ipcMain.handle('characters:open-folder', () => characters.openFolder());

  // Native picker — the desktop equivalent of the browser build's file input (F5).
  ipcMain.handle('characters:pick', async () => {
    const owner = W.get.settings();
    const res = await dialog.showOpenDialog(owner || undefined, {
      title: 'Add characters',
      buttonLabel: 'Add',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    });
    if (res.canceled || !res.filePaths.length) return { added: [], skipped: [] };
    const result = characters.importFiles(res.filePaths);
    W.broadcast('characters:changed');
    return result;
  });

  // Drag-and-drop onto the settings window hands us real paths to copy in.
  ipcMain.handle('characters:import', (_e, paths) => {
    const result = characters.importFiles(paths || []);
    if (result.added.length) W.broadcast('characters:changed');
    return result;
  });

  ipcMain.handle('characters:remove', (_e, id) => {
    characters.remove(id);
    if (store.get('activeCharacter') === id) {
      const next = characters.list()[0];
      if (next) store.set({ activeCharacter: next.id });
    }
    W.broadcast('characters:changed');
    W.broadcast('settings:changed', store.getAll());
    return true;
  });
  ipcMain.handle('character:state', (_e, id) => store.getCharacterState(id));
  ipcMain.handle('character:set-state', (_e, { id, patch }) => {
    const next = store.setCharacterState(id, patch);
    W.broadcast('character:state-changed', { id, state: next });
    return next;
  });

  ipcMain.handle('capture:now', async () => W.withOverlaysHidden(() => capturePrimaryDisplay()));

  ipcMain.handle('ai:chat', async (_e, { history }) => {
    const { apiKey, model } = store.getAll();
    return gemini.chat({ apiKey, model, history });
  });

  ipcMain.handle('ai:test-key', async (_e, apiKey) => gemini.listModels(apiKey));

  ipcMain.handle('app:open-settings', () => {
    W.createSettings();
  });
  ipcMain.handle('app:open-external', (_e, url) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:reset', () => {
    const fresh = store.reset();
    W.broadcast('settings:changed', fresh);
    W.broadcast('characters:changed');
    return fresh;
  });

  ipcMain.handle('app:quit', () => {
    store.flushNow();
    app.quit();
  });
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    charactersFolder: characters.userDir(),
    hotkeyActive: currentHotkey,
  }));

  ipcMain.handle('chat:open', async (_e, { screenshot, anchor }) => {
    const chat = W.createChat();
    if (anchor) W.placeChatNear(anchor);
    chat.show();
    chat.focus();
    chat.webContents.send('chat:opened', { screenshot });
  });

  ipcMain.on('chat:close', () => {
    const chat = W.get.chat();
    if (chat) chat.hide();
    const c = W.get.companion();
    if (c) c.webContents.send('chat:closed');
  });

  ipcMain.on('chat:move-to', (_e, anchor) => W.placeChatNear(anchor));

  ipcMain.on('companion:hover', (_e, hovering) => {
    const c = W.get.companion();
    if (!c) return;
    // Click-through everywhere except the figure itself (F2).
    c.setIgnoreMouseEvents(!hovering, { forward: true });
  });

  ipcMain.on('companion:dismiss', () => dismiss('close-button'));
  ipcMain.on('companion:thinking', (_e, thinking) => {
    const c = W.get.companion();
    if (c) c.webContents.send('companion:thinking', thinking);
  });

  ipcMain.on('settings:close', () => {
    const s = W.get.settings();
    if (s) s.close();
  });
  ipcMain.on('settings:minimize', () => {
    const s = W.get.settings();
    if (s) s.minimize();
  });
}

/* --------------------------------------------------------------- lifecycle */

app.whenReady().then(() => {
  wireIpc();
  W.createCompanion();
  W.createChat();

  const s = store.getAll();
  const res = registerHotkey(s.hotkey);
  if (!res.ok) console.warn('[sidekick]', res.error);

  stopWatchingCharacters = characters.watch(() => W.broadcast('characters:changed'));

  if (s.keepOnDesktop) summon('startup');
  if (!s.apiKey) W.createSettings(); // first run: ask for the key up front

  app.on('activate', () => {
    if (!W.get.companion()) W.createCompanion();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (stopWatchingCharacters) stopWatchingCharacters();
  store.flushNow();
});

// The overlay is hidden, not closed — this empty listener stops Electron from
// quitting the moment the settings window goes away. Quit is explicit (F7).
app.on('window-all-closed', () => {});
