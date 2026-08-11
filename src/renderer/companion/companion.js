/* eslint-env browser */
/**
 * Companion overlay: entrance, rest, idle bob, hover-to-pause, drag, recolour,
 * character picking, and the click that kicks off capture → chat.
 * Maps to F1, F2, F5, F6 in the PRD.
 */
(function () {
  const bridge = window.sidekickBridge;

  const el = {
    stage: document.body,
    character: document.getElementById('character'),
    figure: document.getElementById('figure'),
    art: document.getElementById('figureArt'),
    toolbar: document.getElementById('toolbar'),
    webline: document.querySelector('.webline'),
    weblineSeg: document.querySelector('.webline line'),
    toast: document.getElementById('toast'),
    popCharacters: document.getElementById('popCharacters'),
    popColors: document.getElementById('popColors'),
    charGrid: document.getElementById('charGrid'),
    charNote: document.getElementById('charNote'),
    hue: document.getElementById('hue'),
    sat: document.getElementById('sat'),
    bri: document.getElementById('bri'),
    hueOut: document.getElementById('hueOut'),
    satOut: document.getElementById('satOut'),
    briOut: document.getElementById('briOut'),
    swatches: document.getElementById('swatches'),
    parts: document.getElementById('parts'),
    partList: document.getElementById('partList'),
    partsNote: document.getElementById('partsNote'),
  };

  const BASE_SIZE = 150; // px wide at scale 1

  const state = {
    settings: null,
    characters: [],
    active: null, // character record
    charState: null, // { hue, saturation, brightness, parts, position }
    pos: { x: 200, y: 200 },
    visible: false,
    hovering: false,
    dragging: false,
    openPop: null,
    thinking: false,
    busy: false,
    quietTimer: null,
    wanderTimer: null,
    lastInteraction: Date.now(),
  };

  /* ------------------------------------------------------------------ motion */

  function reducedMotion() {
    return (
      (state.settings && state.settings.reducedMotion) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function liveliness() {
    return (state.settings && state.settings.liveliness) || 'calm';
  }

  function size() {
    return BASE_SIZE * ((state.settings && state.settings.scale) || 1);
  }

  // The hover toolbar hangs below the figure, so the character has to stop short of
  // the bottom edge or the toolbar (and the figure's feet) get clipped off-screen.
  const TOOLBAR_ROOM = 52;

  function bounds() {
    const w = size();
    const h = w * 1.2;
    return {
      minX: 8,
      minY: 8,
      maxX: Math.max(8, window.innerWidth - w - 8),
      maxY: Math.max(8, window.innerHeight - h - TOOLBAR_ROOM),
      w,
      h,
    };
  }

  function clamp(p) {
    const b = bounds();
    return {
      x: Math.min(Math.max(p.x, b.minX), b.maxX),
      y: Math.min(Math.max(p.y, b.minY), b.maxY),
    };
  }

  function applyPosition(animate) {
    const c = el.character;
    c.style.setProperty('--size', `${size()}px`);
    c.style.transition = animate
      ? 'transform 900ms cubic-bezier(.2,.9,.25,1.05)'
      : 'transform 0ms';
    c.style.setProperty('--x', `${state.pos.x}px`);
    c.style.setProperty('--y', `${state.pos.y}px`);
    drawWebline();
    reportAnchor();
  }

  function setMotion(mode) {
    el.character.dataset.motion = mode;
  }

  function drawWebline() {
    const on =
      state.settings &&
      state.settings.webLine &&
      !reducedMotion() &&
      (el.character.dataset.motion === 'swinging' || state.swingingLine);
    el.webline.classList.toggle('on', Boolean(on));
    if (!on) return;
    const b = bounds();
    const cx = state.pos.x + b.w / 2;
    el.weblineSeg.setAttribute('x1', cx);
    el.weblineSeg.setAttribute('y1', 0);
    el.weblineSeg.setAttribute('x2', cx);
    el.weblineSeg.setAttribute('y2', state.pos.y + b.h * 0.12);
  }

  /** Swing in from the top edge, then settle and rest (F2). */
  async function swingIn(target) {
    const b = bounds();
    state.pos = clamp(target);
    el.character.dataset.state = 'in';

    if (reducedMotion()) {
      applyPosition(false);
      settle();
      return;
    }

    // Start above the top edge, drop in on an arc, overshoot, settle.
    state.swingingLine = true;
    setMotion('swinging');
    el.character.style.transition = 'transform 0ms';
    el.character.style.setProperty('--x', `${state.pos.x - 90}px`);
    el.character.style.setProperty('--y', `${-b.h}px`);
    drawWebline();
    // force reflow so the start frame is committed before we transition
    void el.character.offsetWidth;

    el.character.style.transition = 'transform 780ms cubic-bezier(.18,.86,.3,1.08)';
    el.character.style.setProperty('--x', `${state.pos.x}px`);
    el.character.style.setProperty('--y', `${state.pos.y}px`);

    await new Promise((r) => setTimeout(r, 780));
    state.swingingLine = false;
    settle();
  }

  /** Come to rest: subtle idle bob only, per the Calm default (F2 / D9). */
  function settle() {
    el.character.dataset.state = 'rest';
    setMotion(liveliness() === 'off' || reducedMotion() ? 'quiet' : 'idle');
    drawWebline();
    reportAnchor();
    scheduleQuiet();
    scheduleWander();
  }

  async function swingOut() {
    if (reducedMotion()) {
      el.character.dataset.state = 'hidden';
      return;
    }
    const b = bounds();
    state.swingingLine = true;
    setMotion('swinging');
    drawWebline();
    el.character.style.transition = 'transform 420ms cubic-bezier(.5,0,.85,.3)';
    el.character.style.setProperty('--y', `${-b.h}px`);
    await new Promise((r) => setTimeout(r, 420));
    state.swingingLine = false;
    el.character.dataset.state = 'hidden';
    el.webline.classList.remove('on');
  }

  /** Auto-quiet: go fully still after a stretch of no interaction (F2). */
  function scheduleQuiet() {
    clearTimeout(state.quietTimer);
    if (liveliness() === 'off') return;
    state.quietTimer = setTimeout(() => {
      if (!state.hovering && !state.thinking) setMotion('quiet');
    }, 30000);
  }

  /** Playful mode only: drift to a new spot every few minutes, then settle (F2). */
  function scheduleWander() {
    clearTimeout(state.wanderTimer);
    if (liveliness() !== 'playful' || reducedMotion()) return;
    const delay = 90000 + Math.random() * 120000;
    state.wanderTimer = setTimeout(async () => {
      if (state.hovering || state.dragging || state.openPop || state.busy || !state.visible) {
        scheduleWander();
        return;
      }
      const b = bounds();
      state.pos = clamp({
        x: b.minX + Math.random() * (b.maxX - b.minX),
        y: b.minY + Math.random() * (b.maxY - b.minY),
      });
      state.swingingLine = true;
      setMotion('swinging');
      applyPosition(true);
      setTimeout(() => {
        state.swingingLine = false;
        persistPosition();
        settle();
      }, 950);
    }, delay);
  }

  function wake() {
    state.lastInteraction = Date.now();
    if (el.character.dataset.motion === 'quiet' && liveliness() !== 'off' && !reducedMotion()) {
      setMotion('idle');
    }
    scheduleQuiet();
  }

  /* ------------------------------------------------------------- hit-testing */

  // The overlay is click-through except while the cursor is over the figure,
  // its toolbar or an open popover (F2 — "never blocks the app underneath").
  function setHover(on) {
    if (state.hovering === on) return;
    state.hovering = on;
    bridge.send('companion:hover', on);
    if (on) {
      wake();
      setMotion('paused'); // hover pauses motion so it stays clickable (D4)
    } else if (state.visible) {
      setMotion(liveliness() === 'off' || reducedMotion() ? 'quiet' : 'idle');
    }
  }

  function insideInteractive(x, y) {
    const targets = [el.figure, el.toolbar];
    if (state.openPop) targets.push(state.openPop);
    return targets.some((t) => {
      if (!t || t.hidden) return false;
      const r = t.getBoundingClientRect();
      const pad = t === el.figure ? 6 : 10;
      return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    });
  }

  document.addEventListener('mousemove', (e) => {
    if (state.dragging) return;
    setHover(state.visible && insideInteractive(e.clientX, e.clientY));
  });

  document.addEventListener('mouseleave', () => setHover(false));

  // Electron positions a real OS window, so the anchor must be in screen coords.
  // The browser preview positions a div inside the page, so page coords are right.
  const originX = () => (bridge.platform === 'web' ? 0 : window.screenX || 0);
  const originY = () => (bridge.platform === 'web' ? 0 : window.screenY || 0);

  function figureAnchor() {
    const r = el.figure.getBoundingClientRect();
    return { x: originX() + r.left, y: originY() + r.top, width: r.width, height: r.height };
  }

  function reportAnchor() {
    const r = el.figure.getBoundingClientRect();
    if (!r.width) return;
    bridge.send('chat:move-to', figureAnchor());
  }

  /* --------------------------------------------------------------- rendering */

  function tintFilter(cs) {
    const parts = [];
    if (cs.hue) parts.push(`hue-rotate(${cs.hue}deg)`);
    if (cs.saturation !== 100) parts.push(`saturate(${cs.saturation}%)`);
    if (cs.brightness !== 100) parts.push(`brightness(${cs.brightness}%)`);
    return parts.join(' ') || 'none';
  }

  async function renderCharacter() {
    const c = state.active;
    if (!c) return;
    el.art.innerHTML = '';

    if (c.vector) {
      const markup = await bridge.invoke('characters:svg', c.id);
      if (markup) {
        el.art.innerHTML = markup;
        const svg = el.art.querySelector('svg');
        if (svg) {
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
      }
    }
    if (!el.art.firstChild) {
      const img = document.createElement('img');
      img.src = c.url;
      img.alt = c.name;
      img.draggable = false;
      el.art.appendChild(img);
    }

    applyColor();
    buildPartControls();
  }

  function applyColor() {
    const cs = state.charState;
    if (!cs) return;
    el.art.style.filter = tintFilter(cs);

    // Per-part fills, vector characters only (D2).
    const svg = el.art.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('[data-part]').forEach((node) => {
      const part = node.getAttribute('data-part');
      const colour = cs.parts && cs.parts[part];
      if (colour) node.setAttribute('fill', colour);
      else if (node.dataset.originalFill) node.setAttribute('fill', node.dataset.originalFill);
    });
  }

  function buildPartControls() {
    const svg = el.art.querySelector('svg');
    const isVector = Boolean(svg && state.active && state.active.vector);
    el.parts.hidden = !isVector;
    el.partsNote.hidden = isVector;
    if (!isVector) return;

    const seen = new Map();
    svg.querySelectorAll('[data-part]').forEach((node) => {
      const part = node.getAttribute('data-part');
      if (!node.dataset.originalFill) node.dataset.originalFill = node.getAttribute('fill') || '#ffffff';
      if (!seen.has(part)) seen.set(part, node.dataset.originalFill);
    });

    el.partList.innerHTML = '';
    for (const [part, original] of seen) {
      const current = (state.charState.parts && state.charState.parts[part]) || original;
      const chip = document.createElement('label');
      chip.className = 'part-chip';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#ffffff';
      input.addEventListener('input', () => {
        const parts = { ...(state.charState.parts || {}), [part]: input.value };
        saveCharState({ parts });
      });
      const name = document.createElement('span');
      name.textContent = part;
      chip.append(input, name);
      el.partList.appendChild(chip);
    }
  }

  function renderCharacterGrid() {
    el.charGrid.innerHTML = '';
    state.characters.forEach((c) => {
      const card = document.createElement('button');
      card.className = 'char-card';
      card.setAttribute('aria-selected', String(c.id === (state.active && state.active.id)));
      const img = document.createElement('img');
      img.src = c.url;
      img.alt = '';
      img.draggable = false;
      const label = document.createElement('span');
      label.textContent = c.name;
      card.append(img, label);
      card.addEventListener('click', () => selectCharacter(c.id));
      el.charGrid.appendChild(card);
    });
    const userCount = state.characters.filter((c) => c.source === 'user').length;
    el.charNote.textContent = userCount
      ? `${userCount} of your own. Photos glide rather than walk.`
      : 'Add any PNG/JPG/GIF/WEBP/SVG — a transparent PNG works best.';
  }

  function renderColorControls() {
    const cs = state.charState;
    el.hue.value = cs.hue;
    el.sat.value = cs.saturation;
    el.bri.value = cs.brightness;
    el.hueOut.textContent = `${cs.hue}°`;
    el.satOut.textContent = `${cs.saturation}%`;
    el.briOut.textContent = `${cs.brightness}%`;
  }

  const SWATCHES = [0, 30, 60, 120, 170, 200, 240, 280, 320];
  function buildSwatches() {
    el.swatches.innerHTML = '';
    SWATCHES.forEach((h) => {
      const b = document.createElement('button');
      b.style.background = `hsl(${h} 78% 58%)`;
      b.title = `Hue ${h}°`;
      b.addEventListener('click', () => {
        saveCharState({ hue: h });
        renderColorControls();
      });
      el.swatches.appendChild(b);
    });
  }

  /* ------------------------------------------------------------------- state */

  async function saveCharState(patch) {
    state.charState = await bridge.invoke('character:set-state', {
      id: state.active.id,
      patch,
    });
    applyColor();
  }

  function persistPosition() {
    if (!state.active) return;
    bridge.invoke('character:set-state', {
      id: state.active.id,
      patch: { position: { x: Math.round(state.pos.x), y: Math.round(state.pos.y) } },
    });
  }

  async function selectCharacter(id) {
    const found = state.characters.find((c) => c.id === id) || state.characters[0];
    if (!found) return;
    state.active = found;
    state.charState = await bridge.invoke('character:state', found.id);
    await bridge.invoke('settings:set', { activeCharacter: found.id });
    if (state.charState.position) {
      state.pos = clamp(state.charState.position);
      applyPosition(true);
    }
    await renderCharacter();
    renderCharacterGrid();
    renderColorControls();
  }

  async function loadCharacters() {
    state.characters = await bridge.invoke('characters:list');
    if (!state.characters.length) {
      toast('No characters found in assets/characters.', 'bad');
      return;
    }
    const wanted = state.settings.activeCharacter;
    const found = state.characters.find((c) => c.id === wanted) || state.characters[0];
    state.active = found;
    state.charState = await bridge.invoke('character:state', found.id);
    await renderCharacter();
    renderCharacterGrid();
    renderColorControls();
  }

  /* ---------------------------------------------------------------- dragging */

  let drag = null;
  el.figure.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      originX: state.pos.x,
      originY: state.pos.y,
      moved: false,
    };
    el.figure.setPointerCapture(e.pointerId);
    wake();
  });

  el.figure.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    state.dragging = true;
    setMotion('paused');
    state.pos = clamp({ x: drag.originX + dx, y: drag.originY + dy });
    applyPosition(false);
  });

  el.figure.addEventListener('pointerup', async (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    state.dragging = false;
    el.figure.releasePointerCapture?.(e.pointerId);
    if (wasDrag) {
      persistPosition(); // rests where you leave it (F2/F8)
      settle();
    } else {
      onFigureClick();
    }
  });

  el.figure.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFigureClick();
    }
  });

  /* ------------------------------------------------------ capture → chat (F3) */

  async function onFigureClick() {
    if (state.busy) return;
    closePop();
    state.busy = true;
    setMotion('paused');
    toast('Taking a look…');
    try {
      const shot = await bridge.invoke('capture:now');
      hideToast();
      reportAnchor();
      await bridge.invoke('chat:open', { screenshot: shot, anchor: figureAnchor() });
      el.character.dataset.open = 'true';
    } catch (err) {
      toast(err.message || 'Could not capture the screen.', 'bad', 5200);
    } finally {
      state.busy = false;
      settle();
    }
  }

  /* ---------------------------------------------------------------- popovers */

  function closePop() {
    if (state.openPop) state.openPop.hidden = true;
    state.openPop = null;
    el.toolbar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    el.character.dataset.open = 'false';
  }

  function openPop(pop, btn) {
    const same = state.openPop === pop;
    closePop();
    if (same) return;
    pop.hidden = false;
    state.openPop = pop;
    el.character.dataset.open = 'true';
    if (btn) btn.setAttribute('aria-pressed', 'true');
  }

  el.toolbar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    wake();
    switch (btn.dataset.act) {
      case 'capture':
        onFigureClick();
        break;
      case 'characters':
        renderCharacterGrid();
        openPop(el.popCharacters, btn);
        break;
      case 'colors':
        renderColorControls();
        buildPartControls();
        openPop(el.popColors, btn);
        break;
      case 'settings':
        bridge.invoke('app:open-settings');
        break;
      case 'dismiss':
        closePop();
        bridge.send('companion:dismiss');
        break;
    }
  });

  el.popCharacters.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'open-folder') bridge.invoke('characters:open-folder');
  });

  el.popColors.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'reset-color') {
      saveCharState({ hue: 0, saturation: 100, brightness: 100, parts: {} }).then(() => {
        renderColorControls();
        buildPartControls();
      });
    }
  });

  [
    [el.hue, 'hue', el.hueOut, '°'],
    [el.sat, 'saturation', el.satOut, '%'],
    [el.bri, 'brightness', el.briOut, '%'],
  ].forEach(([input, key, out, unit]) => {
    input.addEventListener('input', () => {
      const value = Number(input.value);
      out.textContent = `${value}${unit}`;
      state.charState = { ...state.charState, [key]: value };
      el.art.style.filter = tintFilter(state.charState);
    });
    input.addEventListener('change', () => saveCharState({ [key]: Number(input.value) }));
  });

  /* -------------------------------------------------------------------- toast */

  let toastTimer = null;
  function toast(message, tone = 'info', ms = 2200) {
    el.toast.textContent = message;
    el.toast.dataset.tone = tone;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.hidden = true;
  }

  /* --------------------------------------------------------- summon/dismiss */

  async function onSummon(payload = {}) {
    state.visible = true;
    hideToast();

    const b = bounds();
    let target;
    if (state.charState && state.charState.position) {
      target = state.charState.position; // rests where you left it (F2)
    } else if (payload.cursor) {
      target = {
        x: payload.cursor.x - (window.screenX || 0) - b.w / 2,
        y: payload.cursor.y - (window.screenY || 0) - b.h - 20,
      };
    } else {
      target = { x: b.maxX - 40, y: b.maxY - 40 };
    }

    // In always-on mode the character is already parked — just wake it up.
    if (el.character.dataset.state === 'rest' && payload.reason !== 'hotkey') {
      wake();
      return;
    }
    await swingIn(target);
    persistPosition();
  }

  async function onDismiss() {
    state.visible = false;
    closePop();
    setHover(false);
    bridge.send('chat:close');
    clearTimeout(state.wanderTimer);
    clearTimeout(state.quietTimer);
    await swingOut();
  }

  /* ------------------------------------------------------------------- boot */

  async function boot() {
    state.settings = await bridge.invoke('settings:get');
    buildSwatches();
    await loadCharacters();

    state.pos = clamp(
      (state.charState && state.charState.position) || {
        x: bounds().maxX - 60,
        y: bounds().maxY - 60,
      }
    );
    applyPosition(false);

    bridge.on('summon', onSummon);
    bridge.on('dismiss', onDismiss);
    bridge.on('chat:closed', () => {
      el.character.dataset.open = 'false';
    });
    bridge.on('companion:thinking', (thinking) => {
      state.thinking = Boolean(thinking);
      el.character.dataset.thinking = String(state.thinking);
      if (state.thinking) setMotion(reducedMotion() ? 'quiet' : 'swinging');
      else settle();
    });
    bridge.on('settings:changed', async (s) => {
      state.settings = s;
      applyPosition(false);
      if (s.activeCharacter !== (state.active && state.active.id)) await selectCharacter(s.activeCharacter);
      settle();
    });
    bridge.on('characters:changed', async () => {
      const before = state.active && state.active.id;
      state.characters = await bridge.invoke('characters:list');
      renderCharacterGrid();
      if (!state.characters.some((c) => c.id === before)) await selectCharacter(state.characters[0].id);
    });
    bridge.on('character:state-changed', ({ id, state: cs }) => {
      if (state.active && id === state.active.id) {
        state.charState = cs;
        applyColor();
        renderColorControls();
      }
    });

    window.addEventListener('resize', () => {
      state.pos = clamp(state.pos);
      applyPosition(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.openPop) closePop();
        else bridge.send('companion:dismiss');
      }
    });

    if (bridge.platform === 'web') {
      // In the browser the overlay iframe is pointer-events:none until the cursor is
      // actually over the figure, so the host page forwards pointer positions for
      // hit-testing. This is the browser stand-in for setIgnoreMouseEvents().
      bridge.on('web:pointer', ({ x, y }) => {
        if (state.dragging) return;
        setHover(state.visible && insideInteractive(x, y));
      });
      // The host page loads this in an iframe, so tell it when we can actually
      // receive a summon — otherwise its first broadcast lands before we listen.
      bridge.broadcast('companion:ready');
    }

    if (state.settings.keepOnDesktop) onSummon({ reason: 'startup' });
  }

  boot().catch((err) => {
    console.error(err);
    toast(`Sidekick failed to start: ${err.message}`, 'bad', 8000);
  });
})();
