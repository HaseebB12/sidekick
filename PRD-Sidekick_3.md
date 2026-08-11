# PRD — Sidekick (working title)

A summonable desktop AI companion for Windows. You press a hotkey, your character
(e.g. a Spider-Man figure) swings onto the screen and roams around. You click it, it
screenshots whatever you're looking at and opens a chat, and you talk to it about what's
on your screen — powered by Google Gemini.

**Author:** Abdul Hye · **Version:** Draft 0.1 · **Platform:** Windows 10/11 · **Status:** For review

---

## 1. Summary

Most AI help means alt-tabbing to a browser, screenshotting, uploading, and typing out
context. Sidekick removes all of that. It lives one hotkey away, sees your screen for you,
and answers in place — wrapped in a character you choose and personalize. The character is
the point as much as the utility: it should feel like *your* buddy showed up to help.

## 2. Goals & non-goals

**Goals**
- Summon an AI helper over any app in under a second, without leaving what you're doing.
- Let the AI *see* the current screen so the user doesn't have to describe it.
- Make the assistant feel alive and personal — a character that arrives, moves, and can be recolored.
- Run fully on Windows, offline-capable except for the AI call itself.

**Non-goals (v1)**
- Not a general chatbot with no screen context (it's screen-first).
- Not multi-monitor-aware beyond the primary display (later).
- Not a walking/animated-frames mascot for user photos (a still photo can glide/swing, not walk).
- Not macOS/Linux in v1 (codebase stays cross-platform for later, but only Windows is built and tested).

## 3. Target user & core use case

**User:** a developer, student, or knowledge worker on Windows who hits things they want quick
help with — errors, unfamiliar code, forms, foreign-language text, settings screens.

**The moment it wins:** they're stuck on something *on screen*, and instead of describing it,
they hit the hotkey, click the character, and ask "what's wrong here?" — the AI already sees it.

## 4. Platform & stack

- **Windows 10/11**, delivered as an installer (.exe).
- **Electron** (Node + Chromium) — gives global hotkey, screen capture, transparent always-on-top
  overlay, and one codebase that can extend to Mac/Linux later.
- **Google Gemini API** (free tier, a current **Flash** vision model) for the AI.
- Local storage for settings, character choices, per-character colors, and API key (on-device only).

## 5. Primary user flow

1. **Summon** — user presses the global hotkey. The character **swings in** from the top edge, then
   **settles and rests** where it lands (only a subtle idle bob). (Hidden before this.)
2. **Point at the screen** — user hovers the character; any motion **pauses** so it's an easy target.
   User clicks it.
3. **Capture** — the app hides the character/overlay for a beat, takes a **full-screen screenshot**,
   and opens the **chat panel** next to the character with the screenshot attached.
4. **Converse** — user types a question. The AI answers about the screenshot. User can ask
   **follow-ups** in the same conversation. A **re-capture** button grabs a fresh screenshot when
   the user moves to something new.
5. **Dismiss** — user presses the hotkey again or Esc; the character swings out and disappears,
   the chat closes. (Conversation optionally remembered for next time — see F8.)

## 6. Feature requirements

### F1 — Summon & dismiss
- Global hotkey works from inside any app. Default `Ctrl+Shift+Space`; user-configurable.
- On summon, character appears near the cursor / current focus, plays a swing-in entrance, then
  **settles and stays put** (see F2 — it does not keep pacing across the desktop).
- On dismiss (hotkey again / Esc / close button), character swings out and hides.
- **Confirm D3:** default mode is *summon-then-rest* (hidden until summoned, then quiet). A setting
  **"Keep on desktop always"** switches to a permanent-pet mode where it stays on the desktop and the
  hotkey just calls it to the cursor.

### F2 — Character presence, motion & liveliness
The signature swinging is a *moment*, not a constant. Constant roaming in peripheral vision is
distracting during real work, so the character is lively on arrival, then **settles down and gets out
of the way**.

- **Swing in → settle → rest.** On summon the character plays the swinging entrance, then comes to
  rest and mostly holds still — only a subtle **idle bob / breathing** so it's alive, not a frozen
  statue. No continuous roaming by default.
- **Motion happens on purpose, not always.** Big swinging movement is reserved for meaningful moments:
  the entrance, being summoned to the cursor, and (optionally) a small reaction while "thinking."
  Otherwise the character is parked and quiet.
- **Liveliness setting** (single control, see F7) lets the user dial how much it moves:
  - **Calm** *(default)* — swings in once, then sits still with only idle breathing. Best for focused work.
  - **Playful** — occasionally wanders / swings to a new spot every few minutes, then settles again.
  - **Off** — no idle motion at all; fully static until interacted with.
- **Auto-quiet.** After a period of no interaction the character goes fully still; it wakes (bob / small
  swing) on hover or summon.
- **Rests where you leave it.** The character stays wherever it lands or was last dragged, and
  **remembers that position** per character (see F8). Draggable anywhere on the desktop.
- **Web-line** (thin web string from the top edge during a swing) is an optional, togglable Spider-Man touch.
- Movement is **image-agnostic**: any supplied image swings/glides via position + rotation/tilt, so even
  a still photo reads as alive.
- **Hover pauses** any motion so the character is always reliably clickable.
- **Confirm D5:** true multi-frame **walk cycles** are supported only for characters that ship with
  animation frames (the built-ins). User photos glide/swing, they don't walk.
- **Respects reduced-motion:** if the OS "reduce motion" setting or the app's own toggle is on, the
  entrance and idle motion minimize automatically.
- Character window is transparent, frameless, always-on-top, click-through where it isn't the figure.

### F3 — Screenshot capture
- Captures the **primary display** at full resolution on click / re-capture.
- Character and chat overlay are hidden during capture so they aren't in the shot.
- Screenshot is shown as a thumbnail in the chat and sent to the AI.
- (v1 = whole primary screen. Region-select is a later addition.)

### F4 — AI chat
- **Confirm D1:** an **ongoing conversation** tied to the current screenshot, not a single answer.
  Follow-up questions keep context; **re-capture** attaches a new screenshot to the thread.
- Uses Gemini free-tier Flash vision model. Sends screenshot + question (+ short history).
- Answer rendered with light formatting (code blocks, bold). Errors are specific and actionable
  (bad key, wrong model, rate-limit hit).
- A small **system instruction** frames it as an on-screen helper that reads errors/code/UI and
  gives concise, step-by-step fixes.
- The character shows a **"thinking"** state while the AI responds.

### F5 — Character system (swap & add)
- Ships with 2+ original built-in characters as examples.
- User can **add their own character** by dropping **any image** (PNG/JPG/GIF/WEBP/SVG) into a
  characters folder — this is where the user's Spider-Man figure photo goes (transparent PNG best).
- User switches the active character from a small picker on the companion.
- Character choice persists.

### F6 — Recolor
- **Confirm D2:**
  - **All characters (incl. user photos):** a **hue / tint + saturation** control that recolors the
    whole figure — red Spider-Man → blue/purple/green, etc. Works on any image.
  - **Built-in vector characters only:** optional **per-part recolor** (tap the suit, the eyes, etc.),
    since the app knows the named parts of an SVG. Not possible on a flat photo.
- **Color is saved per character** (each remembers its own color; switching back restores it).

### F7 — Settings
- Gemini **API key** (stored on-device), **model** name, **hotkey**.
- **Liveliness:** Calm *(default)* / Playful / Off — controls how much the character moves (see F2).
- Toggles: keep-on-desktop mode, web-line on/off, reduced motion.
- "Open characters folder" and "Test key" (validates the key, lists available models).

### F8 — Persistence
- Remembers: active character, per-character color, per-character last position, API key, model, hotkey.
- **Confirm:** whether the last conversation is remembered after dismiss, or each summon starts fresh.
  Proposed default: **fresh conversation each summon**, with an optional history later.

## 7. Open decisions to confirm

| # | Decision (my call) | Alternative |
|---|--------------------|-------------|
| D1 | Chat is an ongoing conversation about the screenshot | Single one-shot answer |
| D2 | Hue/tint recolor for all + per-part for built-in vectors; color saved per character | One global color for everyone |
| D3 | Default = summon-then-rest (settles after entrance); a setting enables always-on pet | Always-on by default |
| D4 | Hover pauses the character so it's clickable | Hotkey flies it to the cursor to hold still |
| D9 | Liveliness defaults to **Calm** (still after entrance); Playful/Off are opt-in | Default to Playful (occasional wander) |
| D5 | Still photos swing/glide; only frame-based characters truly walk | (physical limit, not really optional) |
| D8 | Fresh conversation each summon | Remember last conversation |

## 8. Constraints & risks

- **Gemini free tier:** ~5–15 requests/minute, ~1,000/day; free tier data may be used by Google to
  improve products. Fine for personal use; surface rate-limit errors clearly. Don't screenshot secrets.
- **Privacy:** screenshots are sensitive. Everything stays on-device except the single AI call. Make
  the capture moment obvious (character animates, thumbnail shown) so it's never silent/surprising.
- **Moving-target click:** the character rests by default and hover pauses any motion, so it's always
  easy to click (D4, F2).
- **Distraction:** constant motion is fatiguing, so Calm is the default and motion is reserved for
  meaningful moments; users can turn idle motion fully Off (F2, D9).
- **Photo can't walk:** set expectation that user images swing, not step (D5).
- **Transparent always-on-top overlay** behaves well on Windows; keep click-through correct so it
  never blocks the app underneath.
- **Model names drift:** Gemini model IDs change; model is user-editable and "Test key" lists valid ones.

## 9. v1 scope vs later

**In v1**
- Hotkey summon/dismiss, swing-in entrance, roaming swing motion, hover-to-pause.
- Click → full-screen capture → chat conversation via Gemini.
- Add/swap characters via image drop; hue/tint recolor for all; per-part recolor for built-ins.
- Settings, persistence, Windows installer.

**Later**
- Region-select capture (drag a box).
- Streamed/token-by-token answers.
- Conversation history.
- True walk-cycle characters with idle/talking frames; sound.
- Multi-monitor awareness. Mac/Linux builds.

## 10. Success criteria

- Summon-to-answer in a few seconds without leaving the current app.
- The character reliably clickable despite roaming.
- User can drop in their own figure image and recolor it.
- Screenshots never leave the device except for the AI call.
- Clean install-and-run on a fresh Windows 10/11 machine.

## 11. Suggested build phases

1. **Skeleton:** Windows Electron app, transparent overlay, global hotkey summon/dismiss, swing-in entrance.
2. **Motion:** swing-in entrance → settle/rest + idle bob, liveliness control (Calm/Playful/Off),
   auto-quiet, hover-to-pause, optional web-line.
3. **Brain:** click → capture → Gemini chat conversation + thinking state + error handling.
4. **Identity:** character add/swap, hue/tint recolor (all), per-part recolor (built-ins), per-character save.
5. **Polish & ship:** settings, persistence, reduced-motion, installer, README/handover.
