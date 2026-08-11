/* eslint-env browser */
/**
 * Host page for the browser preview. Plays the part the Electron main process
 * plays in the real app: owns the hotkey, shows/hides the surfaces, positions
 * the chat panel next to the character, and toggles overlay click-through.
 */
(function () {
  const bridge = window.sidekickBridge;

  const companion = document.getElementById('companion');
  const chatHolder = document.getElementById('chatHolder');
  const settingsHolder = document.getElementById('settingsHolder');
  const btnSummon = document.getElementById('btnSummon');
  const btnSettings = document.getElementById('btnSettings');
  const keyNote = document.getElementById('keyNote');

  let visible = false;

  /* --------------------------------------------------------- summon/dismiss */

  function summon() {
    visible = true;
    btnSummon.textContent = 'Dismiss';
    bridge.broadcast('summon', { reason: 'hotkey', cursor: null });
  }

  function dismiss() {
    visible = false;
    btnSummon.textContent = 'Summon';
    chatHolder.hidden = true;
    bridge.broadcast('dismiss', { reason: 'hotkey' });
  }

  function toggle() {
    if (visible) dismiss();
    else summon();
  }

  btnSummon.addEventListener('click', toggle);
  btnSettings.addEventListener('click', () => bridge.broadcast('ui:open-settings'));

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape') {
      if (!settingsHolder.hidden) settingsHolder.hidden = true;
      else if (visible) dismiss();
    }
  });

  /* ------------------------------------------------------------ click-through */

  // The companion iframe covers the page, so it stays pointer-events:none and we
  // feed it pointer positions to hit-test. It answers with ui:companion-hover,
  // which is the browser equivalent of BrowserWindow.setIgnoreMouseEvents().
  let raf = null;
  let last = { x: 0, y: 0 };
  window.addEventListener(
    'mousemove',
    (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        bridge.broadcast('web:pointer', last);
      });
    },
    { passive: true }
  );

  bridge.on('ui:companion-hover', (hovering) => {
    companion.style.pointerEvents = hovering ? 'auto' : 'none';
  });

  /* ------------------------------------------------------------------- chat */

  function placeChat(anchor) {
    if (!anchor) return;
    const w = chatHolder.offsetWidth || 420;
    const h = chatHolder.offsetHeight || 560;
    const gap = 16;

    let x = anchor.x + anchor.width + gap;
    if (x + w > window.innerWidth) x = anchor.x - w - gap;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));

    let y = anchor.y + anchor.height / 2 - h / 2;
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));

    chatHolder.style.left = `${x}px`;
    chatHolder.style.top = `${y}px`;
  }

  bridge.on('ui:chat-place', placeChat);
  bridge.on('ui:chat-open', () => {
    chatHolder.hidden = false;
  });
  bridge.on('ui:chat-close', () => {
    chatHolder.hidden = true;
    bridge.broadcast('chat:closed');
  });

  /* --------------------------------------------------------------- settings */

  bridge.on('ui:open-settings', () => {
    settingsHolder.hidden = false;
  });
  bridge.on('ui:add-character', () => {
    settingsHolder.hidden = false;
  });
  bridge.on('ui:settings-close', () => {
    settingsHolder.hidden = true;
  });
  settingsHolder.addEventListener('click', (e) => {
    if (e.target === settingsHolder) settingsHolder.hidden = true;
  });

  /* ------------------------------------------------------------------- boot */

  bridge.invoke('settings:get').then((s) => {
    if (!s.apiKey) {
      keyNote.textContent = 'No Gemini API key saved yet — open Settings and paste one, or the chat will only show an error.';
    }
  });
  bridge.on('settings:changed', (s) => {
    keyNote.textContent = s.apiKey ? '' : keyNote.textContent;
  });

  // Show the character straight away — but only once the overlay iframe says it is
  // listening, otherwise the first summon broadcast goes nowhere.
  let summonedOnce = false;
  bridge.on('companion:ready', () => {
    if (summonedOnce) return;
    summonedOnce = true;
    summon();
  });
  // Safety net in case the ready ping is missed (cached iframe, slow load).
  setTimeout(() => {
    if (!summonedOnce) {
      summonedOnce = true;
      summon();
    }
  }, 1500);
})();
