'use strict';

const { desktopCapturer, screen } = require('electron');

/**
 * Full-resolution grab of the primary display (F3).
 *
 * The caller is responsible for hiding the overlay windows first — see
 * `withOverlaysHidden` in windows.js — so Sidekick never appears in its own shot.
 */
async function capturePrimaryDisplay() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    fetchWindowIcons: false,
  });

  if (!sources.length) throw new Error('No screen sources available to capture.');

  // display_id is a string on Windows; fall back to the first screen.
  const match =
    sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];

  const image = match.thumbnail;
  if (image.isEmpty()) throw new Error('Screen capture came back empty.');

  const size = image.getSize();
  return {
    dataUrl: image.toDataURL(),
    base64: image.toPNG().toString('base64'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
    takenAt: Date.now(),
  };
}

module.exports = { capturePrimaryDisplay };
