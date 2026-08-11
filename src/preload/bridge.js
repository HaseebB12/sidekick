'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * The one and only surface the renderers see. The browser build (src/renderer/shared/bridge-web.js)
 * implements exactly this shape, which is why the same UI code runs in both.
 */
function expose() {
  contextBridge.exposeInMainWorld('sidekickBridge', {
    platform: 'electron',
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    send: (channel, payload) => ipcRenderer.send(channel, payload),
    on: (channel, cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    /**
     * Real path behind a dropped/picked File. Electron 32+ removed File.path, so
     * drag-and-drop needs webUtils; the browser build returns null and falls back
     * to reading the file as a data URL instead.
     */
    filePathFor: (file) => {
      try {
        return webUtils.getPathForFile(file) || null;
      } catch {
        return null;
      }
    },
  });
}

module.exports = { expose };
