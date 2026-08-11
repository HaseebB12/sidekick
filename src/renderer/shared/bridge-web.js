/* eslint-env browser */
/**
 * Browser implementation of `window.sidekickBridge`.
 *
 * The Electron preload defines the same object, so this file no-ops there. In the
 * localhost build the differences are honest ones the browser imposes:
 *   - capture uses getDisplayMedia (you pick the screen) instead of desktopCapturer
 *   - "characters folder" becomes a file picker, stored in localStorage
 *   - the global hotkey is only global within the page
 *   - Gemini is called straight from the page instead of via the main process
 */
(function () {
  if (window.sidekickBridge) return; // Electron already provided it.

  const SETTINGS_KEY = 'sidekick:settings';
  const CHARS_KEY = 'sidekick:user-characters';

  const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'gemini-2.0-flash',
    hotkey: 'Control+Shift+Space',
    liveliness: 'calm',
    keepOnDesktop: false,
    webLine: true,
    reducedMotion: false,
    scale: 1,
    activeCharacter: 'pip',
    characters: {},
    rememberConversation: false,
  };
  const CHARACTER_DEFAULTS = { hue: 0, saturation: 100, brightness: 100, parts: {}, position: null };

  const SYSTEM_INSTRUCTION =
    "You are Sidekick, a desktop AI companion that can see the user's screen. The attached image is a " +
    'screenshot of what the user is looking at right now. Read errors, code, UI, forms and text in the ' +
    'screenshot and answer about them directly. Be concise. Lead with the answer, then give short ' +
    'numbered steps when a fix is needed. Use fenced code blocks for code, commands and file paths. If ' +
    'the screenshot does not contain what you would need, say exactly what is missing and suggest the ' +
    'user hit Re-capture on the right screen. Never invent UI elements or error text that is not ' +
    'visible in the image.';

  /* ------------------------------------------------------------------ storage */

  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { ...DEFAULT_SETTINGS, ...parsed, characters: parsed.characters || {} };
    } catch {
      return { ...DEFAULT_SETTINGS, characters: {} };
    }
  }

  /**
   * localStorage writes fail for real reasons in a browser — the 5MB quota (a single
   * photo character stored as a data URL blows it), or site data being blocked
   * entirely (VS Code's Simple Browser, private windows, strict privacy settings).
   * An unguarded throw here used to take the whole overlay down mid-boot, so failures
   * are surfaced instead of propagating.
   */
  let storageWarned = false;

  function writeSettings(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (err) {
      const quota = /quota|exceeded/i.test(err.name + err.message);
      if (!storageWarned) {
        storageWarned = true;
        console.error(
          quota
            ? '[sidekick] Browser storage is full — settings will not persist. Remove a large custom character.'
            : `[sidekick] Browser storage is unavailable (${err.name}); settings will not persist this session.`
        );
      }
      broadcast('ui:storage-error', {
        quota,
        message: quota
          ? 'Browser storage is full. Custom character images are stored in this browser and one large photo can fill it — remove a character, or use the desktop app where they live on disk.'
          : 'This browser is blocking site storage, so nothing will be remembered. Open the preview in a normal Chrome/Edge window.',
      });
    }
    return s;
  }

  function readUserCharacters() {
    try {
      return JSON.parse(localStorage.getItem(CHARS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  /* ------------------------------------------------------- cross-frame events */

  const channel = new BroadcastChannel('sidekick');
  const listeners = new Map(); // channelName -> Set<cb>

  channel.onmessage = (e) => {
    const { channel: name, payload } = e.data || {};
    const set = listeners.get(name);
    if (set) set.forEach((cb) => cb(payload));
  };

  function emitLocal(name, payload) {
    const set = listeners.get(name);
    if (set) set.forEach((cb) => cb(payload));
  }

  function broadcast(name, payload) {
    channel.postMessage({ channel: name, payload });
    emitLocal(name, payload);
  }

  /* ---------------------------------------------------------------- capture */

  let sharedStream = null;

  async function ensureStream() {
    if (sharedStream && sharedStream.active) return sharedStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('This browser cannot capture the screen. Use the Electron build for real capture.');
    }
    sharedStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor', frameRate: 5 },
      audio: false,
    });
    sharedStream.getVideoTracks()[0].addEventListener('ended', () => {
      sharedStream = null;
    });
    return sharedStream;
  }

  async function captureScreen() {
    let stream;
    try {
      stream = await ensureStream();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Screen sharing was declined, so there is nothing to look at. Click the character again to retry.');
      }
      throw err;
    }

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // One extra frame so we never grab a black first paint.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const w = video.videoWidth || 1920;
    const h = video.videoHeight || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    video.pause();
    video.srcObject = null;

    const dataUrl = canvas.toDataURL('image/png');
    return {
      dataUrl,
      base64: dataUrl.split(',')[1],
      mimeType: 'image/png',
      width: w,
      height: h,
      takenAt: Date.now(),
    };
  }

  /* ------------------------------------------------------------------ gemini */

  const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

  function describeError(status, body) {
    const msg = body && body.error && body.error.message ? body.error.message : '';
    if (status === 400 && /API key not valid/i.test(msg)) {
      return 'That API key was rejected. Paste a fresh key from aistudio.google.com/apikey into Settings.';
    }
    if (status === 400) return `Gemini rejected the request: ${msg || 'bad request'}`;
    if (status === 401 || status === 403) {
      return 'Your API key is missing, expired, or lacks access to this model. Check Settings → Test key.';
    }
    if (status === 404) return `Model not found. Settings → Test key lists the models your key can use.${msg ? ` (${msg})` : ''}`;
    if (status === 429) return 'Rate limit hit on the Gemini free tier. Wait about a minute and try again.';
    if (status >= 500) return "Google's side is having a moment (server error). Try again in a few seconds.";
    return msg || `Gemini returned HTTP ${status}.`;
  }

  async function geminiChat({ history }) {
    const { apiKey, model } = readSettings();
    if (!apiKey) throw new Error('No Gemini API key yet. Open Settings and paste one from aistudio.google.com/apikey.');

    const contents = history.map((t) => {
      const parts = [];
      if (t.image) parts.push({ inline_data: { mime_type: t.image.mimeType, data: t.image.base64 } });
      if (t.text) parts.push({ text: t.text });
      return { role: t.role === 'model' ? 'model' : 'user', parts };
    });

    const res = await fetch(`${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
    }).catch((err) => {
      throw new Error(`Could not reach Gemini: ${err.message}. Check your internet connection.`);
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok) throw new Error(describeError(res.status, body));

    const candidate = body && body.candidates && body.candidates[0];
    if (!candidate) {
      const blocked = body && body.promptFeedback && body.promptFeedback.blockReason;
      throw new Error(blocked ? `Gemini blocked that request (${blocked}).` : 'Gemini returned an empty response.');
    }
    const text = ((candidate.content && candidate.content.parts) || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) throw new Error(`Gemini finished with no text (${candidate.finishReason || 'unknown reason'}).`);
    return { text, finishReason: candidate.finishReason || 'STOP' };
  }

  async function geminiModels(apiKey) {
    if (!apiKey) throw new Error('Enter an API key first.');
    const res = await fetch(`${API_ROOT}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`).catch((err) => {
      throw new Error(`Could not reach Gemini: ${err.message}.`);
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok) throw new Error(describeError(res.status, body));
    return (body.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' }))
      .filter((m) => m.id && !/embedding|aqa|imagen|veo/i.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /* --------------------------------------------------------------- character */

  const BUILTINS = [
    { id: 'pip', name: 'Pip', url: '/assets/characters/pip.svg' },
    { id: 'zephyr', name: 'Zephyr', url: '/assets/characters/zephyr.svg' },
  ].map((c) => ({ ...c, source: 'builtin', ext: '.svg', vector: true }));

  function listCharacters() {
    return [...BUILTINS, ...readUserCharacters()];
  }

  /* ------------------------------------------------------------------ router */

  const handlers = {
    'settings:get': () => readSettings(),
    'settings:set': (patch = {}) => {
      const next = writeSettings({ ...readSettings(), ...patch });
      broadcast('settings:changed', next);
      return next;
    },

    'characters:list': () => listCharacters(),
    'characters:svg': async (id) => {
      const c = listCharacters().find((x) => x.id === id);
      if (!c || !c.vector) return null;
      if (c.url.startsWith('data:')) return atob(c.url.split(',')[1]);
      const res = await fetch(c.url);
      return res.ok ? res.text() : null;
    },
    'characters:open-folder': () => {
      broadcast('ui:add-character');
      return true;
    },
    'characters:add': (file) => {
      const list = readUserCharacters();
      const next = list.filter((c) => c.id !== file.id).concat([file]);
      try {
        localStorage.setItem(CHARS_KEY, JSON.stringify(next));
      } catch (err) {
        throw new Error(
          /quota|exceeded/i.test(err.name + err.message)
            ? 'That image is too large for browser storage (about 4MB of data URL is the ceiling). Use a smaller image, or add it in the desktop app where characters live on disk.'
            : `Could not save the character: this browser is blocking site storage (${err.name}).`
        );
      }
      broadcast('characters:changed');
      return next;
    },
    'characters:remove': (id) => {
      const next = readUserCharacters().filter((c) => c.id !== id);
      try {
        localStorage.setItem(CHARS_KEY, JSON.stringify(next));
      } catch {
        /* removing frees space; a failure here is not worth blocking on */
      }
      broadcast('characters:changed');
      return next;
    },

    'character:state': (id) => ({ ...CHARACTER_DEFAULTS, ...(readSettings().characters[id] || {}) }),
    'character:set-state': ({ id, patch }) => {
      const s = readSettings();
      const next = { ...CHARACTER_DEFAULTS, ...(s.characters[id] || {}), ...patch };
      s.characters[id] = next;
      writeSettings(s);
      broadcast('character:state-changed', { id, state: next });
      return next;
    },

    'capture:now': () => captureScreen(),
    'ai:chat': (args) => geminiChat(args),
    'ai:test-key': (key) => geminiModels(key),

    'app:reset': () => {
      try {
        localStorage.removeItem(SETTINGS_KEY);
        localStorage.removeItem(CHARS_KEY);
      } catch {
        /* nothing stored means nothing to clear */
      }
      storageWarned = false;
      const fresh = { ...DEFAULT_SETTINGS, characters: {} };
      broadcast('settings:changed', fresh);
      broadcast('characters:changed');
      return fresh;
    },
    'app:open-settings': () => broadcast('ui:open-settings'),
    'app:open-external': (url) => window.open(url, '_blank', 'noopener'),
    'app:quit': () => broadcast('ui:quit'),
    'app:info': () => ({ platform: 'web', version: '0.1.0', charactersFolder: null, hotkeyActive: null }),

    'chat:open': ({ screenshot, anchor }) => {
      broadcast('ui:chat-place', anchor); // host page positions the panel
      broadcast('ui:chat-open', { screenshot }); // host page reveals it
      broadcast('chat:opened', { screenshot }); // the chat renderer itself
    },
  };

  const senders = {
    'chat:close': () => broadcast('ui:chat-close'),
    'chat:move-to': (anchor) => broadcast('ui:chat-place', anchor),
    'companion:hover': (hovering) => broadcast('ui:companion-hover', hovering),
    'companion:dismiss': () => broadcast('dismiss', { reason: 'close-button' }),
    'companion:thinking': (t) => broadcast('companion:thinking', t),
    'settings:close': () => broadcast('ui:settings-close'),
    'settings:minimize': () => {},
  };

  window.sidekickBridge = {
    platform: 'web',
    /** No real paths in a browser — callers fall back to reading a data URL. */
    filePathFor: () => null,
    async invoke(name, payload) {
      const fn = handlers[name];
      if (!fn) throw new Error(`Unsupported in the browser build: ${name}`);
      return fn(payload);
    },
    send(name, payload) {
      const fn = senders[name] || handlers[name];
      if (fn) Promise.resolve(fn(payload)).catch((e) => console.error(name, e));
    },
    on(name, cb) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(cb);
      return () => listeners.get(name).delete(cb);
    },
    /** Host-page helper: lets index.html drive summon/dismiss/etc. */
    broadcast,
  };
})();
