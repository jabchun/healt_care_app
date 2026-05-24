/**
 * callAI — unified AI request function
 * @param {object} opts
 * @param {string}   opts.model   - OpenRouter model ID
 * @param {string}  [opts.system] - system prompt (optional)
 * @param {Array}    opts.messages - chat messages (role/content)
 * @returns {Promise<string>} model reply text
 */
async function callAI({ model, system, messages }) {
  const payload = { model, messages: [] };
  if (system) payload.messages.push({ role: 'system', content: system });
  payload.messages.push(...messages);

  const res = await fetch(`${CONFIG.BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content;
  // Gemini via OpenRouter sometimes returns content as an array of parts
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === 'string' ? p : p.text || '')).join('');
  }
  return content;
}

// Backward-compatible wrapper
async function callOpenRouter(messages, model = 'openai/gpt-4o-mini') {
  return callAI({ model, messages });
}
