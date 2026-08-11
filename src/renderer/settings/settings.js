/* eslint-env browser */
/** Settings window (F7) — everything persists through the same bridge the overlay uses. */
(function () {
  const bridge = window.sidekickBridge;
  const $ = (id) => document.getElementById(id);

  const el = {
    apiKey: $('apiKey'),
    reveal: $('btnReveal'),
    model: $('model'),
    modelList: $('modelList'),
    test: $('btnTest'),
    testResult: $('testResult'),
    hotkey: $('hotkey'),
    record: $('btnRecord'),
    hotkeyHint: $('hotkeyHint'),
    keepOnDesktop: $('keepOnDesktop'),
    rememberConversation: $('rememberConversation'),
    liveliness: $('liveliness'),
    livelinessHint: $('livelinessHint'),
    scale: $('scale'),
    scaleOut: $('scaleOut'),
    webLine: $('webLine'),
    reducedMotion: $('reducedMotion'),
    add: $('btnAdd'),
    folder: $('btnFolder'),
    folderHint: $('folderHint'),
    fileInput: $('fileInput'),
    charStrip: $('charStrip'),
    charHint: $('charHint'),
    about: $('aboutText'),
    reset: $('btnReset'),
    quit: $('btnQuit'),
    saved: $('saved'),
    min: $('btnMin'),
    close: $('btnClose'),
  };

  const LIVELINESS_COPY = {
    calm: 'Swings in once, then sits still with only idle breathing. Best for focused work.',
    playful: 'Occasionally drifts to a new spot every few minutes, then settles again.',
    off: 'No idle motion at all — fully static until you interact with it.',
  };

  let settings = null;
  let savedTimer = null;

  function flashSaved() {
    el.saved.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      el.saved.hidden = true;
    }, 1100);
  }

  async function save(patch) {
    try {
      settings = await bridge.invoke('settings:set', patch);
      flashSaved();
      return true;
    } catch (err) {
      note(el.hotkeyHint, err.message, 'bad');
      return false;
    }
  }

  function note(node, text, tone) {
    node.textContent = text;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  /* ------------------------------------------------------------------ render */

  function render() {
    el.apiKey.value = settings.apiKey || '';
    el.model.value = settings.model || '';
    el.hotkey.value = settings.hotkey || '';
    el.keepOnDesktop.checked = Boolean(settings.keepOnDesktop);
    el.rememberConversation.checked = Boolean(settings.rememberConversation);
    el.webLine.checked = Boolean(settings.webLine);
    el.reducedMotion.checked = Boolean(settings.reducedMotion);
    el.scale.value = settings.scale || 1;
    el.scaleOut.textContent = `${Math.round((settings.scale || 1) * 100)}%`;

    el.liveliness.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === settings.liveliness));
    });
    el.livelinessHint.textContent = LIVELINESS_COPY[settings.liveliness] || '';
  }

  async function renderCharacters() {
    const list = await bridge.invoke('characters:list');
    el.charStrip.innerHTML = '';
    list.forEach((c) => {
      const fig = document.createElement('figure');
      fig.setAttribute('aria-selected', String(c.id === settings.activeCharacter));
      fig.title = c.source === 'builtin' ? `${c.name} — built-in (per-part recolour)` : `${c.name} — yours`;

      const img = document.createElement('img');
      img.src = c.url;
      img.alt = '';
      const cap = document.createElement('figcaption');
      cap.textContent = c.name;
      fig.append(img, cap);

      fig.addEventListener('click', async () => {
        await save({ activeCharacter: c.id });
        renderCharacters();
      });

      // Only the user's own images can be deleted — built-ins always stay.
      if (c.source === 'user') {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'char-remove';
        del.textContent = '×';
        del.title = `Remove ${c.name}`;
        del.setAttribute('aria-label', `Remove ${c.name}`);
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await bridge.invoke('characters:remove', c.id);
            settings = await bridge.invoke('settings:get');
            note(el.charHint, `Removed ${c.name}.`);
            await renderCharacters();
          } catch (err) {
            note(el.charHint, err.message, 'bad');
          }
        });
        fig.appendChild(del);
      }

      el.charStrip.appendChild(fig);
    });
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  /** Fit an image inside `max` px, preserving transparency and aspect ratio. */
  function downscale(dataUrl, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && dataUrl.length < 400000) return resolve(dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('That file is not an image this browser can read.'));
      img.src = dataUrl;
    });
  }

  /**
   * One code path for both builds (F5). On the desktop the file is copied into the
   * characters folder; in the browser it is inlined as a data URL in localStorage.
   */
  async function addFiles(files) {
    const chosen = [...files];
    if (!chosen.length) return;

    if (bridge.platform !== 'web' && bridge.filePathFor) {
      const paths = chosen.map((f) => bridge.filePathFor(f)).filter(Boolean);
      if (paths.length) {
        try {
          const { added, skipped } = await bridge.invoke('characters:import', paths);
          const msg = [
            added.length ? `Added ${added.join(', ')}.` : '',
            skipped.length ? `Skipped ${skipped.join(', ')} — not a supported image.` : '',
          ]
            .filter(Boolean)
            .join(' ');
          note(el.charHint, msg || 'Nothing to add.', skipped.length && !added.length ? 'bad' : null);
        } catch (err) {
          note(el.charHint, err.message, 'bad');
        }
        await renderCharacters();
        return;
      }
    }

    let added = 0;
    for (const file of chosen) {
      if (!/^image\//.test(file.type) && !/\.svg$/i.test(file.name)) continue;
      try {
        const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
        const raw = await readAsDataUrl(file);
        // Browser storage is ~5MB total, so a phone photo has to be shrunk before it
        // is inlined. SVGs are text and stay as-is.
        const url = isSvg ? raw : await downscale(raw, 512);
        const base = file.name.replace(/\.[^.]+$/, '');
        await bridge.invoke('characters:add', {
          id: `user:${base}`,
          name: base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
          source: 'user',
          ext: isSvg ? '.svg' : '.png',
          url,
          vector: isSvg,
        });
        added += 1;
      } catch (err) {
        note(el.charHint, err.message, 'bad');
        await renderCharacters();
        return;
      }
    }
    note(el.charHint, added ? `Added ${added} character${added === 1 ? '' : 's'}.` : 'No supported images in that drop.');
    await renderCharacters();
    flashSaved();
  }

  /* ------------------------------------------------------------------ events */

  el.reveal.addEventListener('click', () => {
    const showing = el.apiKey.type === 'text';
    el.apiKey.type = showing ? 'password' : 'text';
    el.reveal.textContent = showing ? 'Show' : 'Hide';
  });

  el.apiKey.addEventListener('change', () => save({ apiKey: el.apiKey.value.trim() }));
  el.model.addEventListener('change', () => save({ model: el.model.value.trim() }));

  el.test.addEventListener('click', async () => {
    const key = el.apiKey.value.trim();
    el.test.disabled = true;
    note(el.testResult, 'Checking…');
    try {
      await save({ apiKey: key });
      const models = await bridge.invoke('ai:test-key', key);
      el.modelList.innerHTML = '';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.label = m.label;
        el.modelList.appendChild(opt);
      });
      const flash = models.filter((m) => /flash/i.test(m.id));
      note(
        el.testResult,
        `Key works — ${models.length} usable models. ${
          flash.length ? `Flash options: ${flash.slice(0, 3).map((m) => m.id).join(', ')}` : ''
        }`,
        'good'
      );
      if (!models.some((m) => m.id === el.model.value.trim()) && flash.length) {
        el.model.value = flash[0].id;
        await save({ model: flash[0].id });
      }
    } catch (err) {
      note(el.testResult, err.message, 'bad');
    } finally {
      el.test.disabled = false;
    }
  });

  /* Hotkey recorder */
  let recording = false;
  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

  function stopRecording(text) {
    recording = false;
    el.record.textContent = 'Record';
    if (text) note(el.hotkeyHint, text);
  }

  el.record.addEventListener('click', () => {
    if (recording) {
      stopRecording('Cancelled.');
      return;
    }
    recording = true;
    el.record.textContent = 'Press keys…';
    note(el.hotkeyHint, 'Press your combination now (needs at least one modifier).');
    el.hotkey.focus();
  });

  window.addEventListener('keydown', async (e) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') {
      stopRecording('Cancelled — hotkey unchanged.');
      return;
    }
    if (MODIFIER_KEYS.has(e.key)) return;

    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.shiftKey) mods.push('Shift');
    if (e.altKey) mods.push('Alt');
    if (e.metaKey) mods.push('Super');
    if (!mods.length) {
      note(el.hotkeyHint, 'Needs at least one modifier (Ctrl / Alt / Shift).', 'bad');
      return;
    }

    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (/^[a-z]$/.test(key)) key = key.toUpperCase();
    else if (key.startsWith('Arrow')) key = key.slice(5);

    const accelerator = [...mods, key].join('+');
    el.hotkey.value = accelerator;
    const ok = await save({ hotkey: accelerator });
    stopRecording(ok ? `Hotkey set to ${accelerator}.` : null);
    if (ok) delete el.hotkeyHint.dataset.tone;
  });

  el.keepOnDesktop.addEventListener('change', () => save({ keepOnDesktop: el.keepOnDesktop.checked }));
  el.rememberConversation.addEventListener('change', () =>
    save({ rememberConversation: el.rememberConversation.checked })
  );
  el.webLine.addEventListener('change', () => save({ webLine: el.webLine.checked }));
  el.reducedMotion.addEventListener('change', () => save({ reducedMotion: el.reducedMotion.checked }));

  el.liveliness.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    await save({ liveliness: btn.dataset.value });
    render();
  });

  el.scale.addEventListener('input', () => {
    el.scaleOut.textContent = `${Math.round(Number(el.scale.value) * 100)}%`;
  });
  el.scale.addEventListener('change', () => save({ scale: Number(el.scale.value) }));

  el.add.addEventListener('click', async () => {
    // The desktop app gets a real native picker; the browser falls back to <input type=file>.
    if (bridge.platform !== 'web') {
      try {
        const { added, skipped } = await bridge.invoke('characters:pick');
        if (added.length) note(el.charHint, `Added ${added.join(', ')}.`);
        else if (skipped.length) note(el.charHint, `Skipped ${skipped.join(', ')}.`, 'bad');
        await renderCharacters();
        return;
      } catch (err) {
        note(el.charHint, err.message, 'bad');
        return;
      }
    }
    el.fileInput.click();
  });

  el.folder.addEventListener('click', () => bridge.invoke('characters:open-folder'));

  el.fileInput.addEventListener('change', async () => {
    await addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  /* Drag any image onto the window to add it — works in both builds. */
  const dropZone = document.body;
  let dragDepth = 0;

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    document.body.classList.add('dropping');
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dropping');
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    if (e.dataTransfer.files.length) await addFiles(e.dataTransfer.files);
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-external]');
    if (link) {
      e.preventDefault();
      bridge.invoke('app:open-external', link.dataset.external);
    }
  });

  // Esc closes the window. The hotkey recorder registers first and preventDefaults
  // every key while it is armed, where Esc already means "cancel recording".
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) bridge.send('settings:close');
  });

  // Escape hatch for state that has gone bad — a character parked off-screen, a
  // storage quota that can't be written to, a half-saved custom image.
  let resetArmed = false;
  el.reset.addEventListener('click', async () => {
    if (!resetArmed) {
      resetArmed = true;
      el.reset.textContent = 'Click again to confirm';
      setTimeout(() => {
        resetArmed = false;
        el.reset.textContent = 'Reset everything';
      }, 4000);
      return;
    }
    resetArmed = false;
    el.reset.textContent = 'Reset everything';
    try {
      await bridge.invoke('app:reset');
      settings = await bridge.invoke('settings:get');
      render();
      await renderCharacters();
      note(el.testResult, 'Everything reset. Paste an API key to start again.', null);
    } catch (err) {
      note(el.charHint, err.message, 'bad');
    }
  });

  el.quit.addEventListener('click', () => bridge.invoke('app:quit'));
  el.min.addEventListener('click', () => bridge.send('settings:minimize'));
  el.close.addEventListener('click', () => bridge.send('settings:close'));

  bridge.on('ui:storage-error', (e) => note(el.charHint, e.message, 'bad'));
  bridge.on('characters:changed', renderCharacters);
  bridge.on('settings:changed', (s) => {
    settings = s;
    render();
  });

  /* -------------------------------------------------------------------- boot */

  (async function boot() {
    settings = await bridge.invoke('settings:get');
    render();
    await renderCharacters();

    const info = await bridge.invoke('app:info');
    el.about.textContent = `Sidekick ${info.version} · ${
      info.platform === 'web' ? 'browser preview' : 'Windows desktop'
    }${info.hotkeyActive ? ` · hotkey ${info.hotkeyActive} active` : ''}`;

    if (info.platform === 'web') {
      el.folder.hidden = true; // no filesystem folder to open in a browser
      el.folderHint.textContent =
        'Pick a file or drag an image anywhere onto this window. Browser preview: characters are stored in this browser only.';
      el.hotkeyHint.textContent =
        'Browser preview: the hotkey only works while this page has focus. The desktop app registers it system-wide.';
      el.quit.hidden = true;
    } else {
      el.folderHint.textContent = `Pick a file, or drag an image anywhere onto this window. PNG / JPG / GIF / WEBP / SVG.\nThey are copied into:\n${info.charactersFolder}`;
      el.folderHint.style.whiteSpace = 'pre-wrap';
    }

    if (!settings.apiKey) {
      note(el.testResult, 'Paste a key to get started — Sidekick can’t answer without one.', 'bad');
      el.apiKey.focus();
    }
  })();
})();
