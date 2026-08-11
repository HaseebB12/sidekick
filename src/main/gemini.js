'use strict';

const { SYSTEM_INSTRUCTION } = require('../shared/defaults');

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini calls (F4). Errors are translated into something a human can act on
 * rather than a raw 400 blob — bad key, wrong model, rate limit (constraint §8).
 */

function describeError(status, body) {
  const apiMessage = body && body.error && body.error.message ? body.error.message : '';
  switch (status) {
    case 400:
      if (/API key not valid/i.test(apiMessage)) {
        return 'That API key was rejected. Paste a fresh key from aistudio.google.com/apikey into Settings.';
      }
      return `Gemini rejected the request: ${apiMessage || 'bad request'}`;
    case 401:
    case 403:
      return 'Your API key is missing, expired, or lacks access to this model. Check Settings → Test key.';
    case 404:
      return `Model not found. Open Settings → Test key to see the models your key can actually use.${
        apiMessage ? ` (${apiMessage})` : ''
      }`;
    case 429:
      return 'Rate limit hit on the Gemini free tier. Wait about a minute and try again.';
    case 500:
    case 503:
      return 'Google\'s side is having a moment (server error). Try again in a few seconds.';
    default:
      return apiMessage || `Gemini returned HTTP ${status}.`;
  }
}

async function request(url, init, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini took too long to answer. Try again.');
    throw new Error(`Could not reach Gemini: ${err.message}. Check your internet connection.`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.model
 * @param {Array<{role:'user'|'model', text:string, image?:{base64:string,mimeType:string}}>} args.history
 */
async function chat({ apiKey, model, history }) {
  if (!apiKey) {
    throw new Error('No Gemini API key yet. Open Settings and paste one from aistudio.google.com/apikey.');
  }

  const contents = history.map((turn) => {
    const parts = [];
    if (turn.image) {
      parts.push({ inline_data: { mime_type: turn.image.mimeType, data: turn.image.base64 } });
    }
    if (turn.text) parts.push({ text: turn.text });
    return { role: turn.role === 'model' ? 'model' : 'user', parts };
  });

  const res = await request(
    `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
    }
  );

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) throw new Error(describeError(res.status, body));

  const candidate = body && body.candidates && body.candidates[0];
  if (!candidate) {
    const blocked = body && body.promptFeedback && body.promptFeedback.blockReason;
    throw new Error(
      blocked
        ? `Gemini blocked that request (${blocked}). Try rephrasing, or re-capture a different screen.`
        : 'Gemini returned an empty response.'
    );
  }

  const text = (candidate.content && candidate.content.parts ? candidate.content.parts : [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('The answer was cut off before any text came back. Try a narrower question.');
    }
    throw new Error(`Gemini finished with no text (${candidate.finishReason || 'unknown reason'}).`);
  }

  return { text, finishReason: candidate.finishReason || 'STOP' };
}

/** Settings → "Test key": validates the key and lists usable vision models (F7). */
async function listModels(apiKey) {
  if (!apiKey) throw new Error('Enter an API key first.');
  const res = await request(`${API_ROOT}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`, {
    method: 'GET',
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error(describeError(res.status, body));

  const models = (body.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: String(m.name || '').replace(/^models\//, ''),
      label: m.displayName || '',
    }))
    .filter((m) => m.id && !/embedding|aqa|imagen|veo/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return models;
}

module.exports = { chat, listModels };
