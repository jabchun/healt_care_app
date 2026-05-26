/**
 * callAI — unified AI request function
 * Google AI Studio → native Gemini API (inline_data 방식)
 * OpenRouter 등  → OpenAI-compatible API
 */
async function callAI({ model, system, messages }) {
  if (CONFIG.BASE_URL.includes('generativelanguage.googleapis.com')) {
    return _callGemini({ model, system, messages });
  }
  return _callOpenAICompat({ model, system, messages });
}

// ── Google AI Studio (native Gemini API) ──────────────────────
async function _callGemini({ model, system, messages }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.OPENROUTER_API_KEY}`;

  const body = { contents: [] };
  if (system) body.system_instruction = { parts: [{ text: system }] };

  for (const msg of messages) {
    const parts = [];
    const c = msg.content;

    if (typeof c === 'string') {
      parts.push({ text: c });
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
          // data:image/jpeg;base64,XXXX → inline_data
          const dataUrl = part.image_url.url;
          const comma   = dataUrl.indexOf(',');
          const header  = dataUrl.slice(0, comma);          // "data:image/jpeg;base64"
          const b64     = dataUrl.slice(comma + 1);         // base64 string
          const mime    = header.match(/data:([^;]+)/)[1];  // "image/jpeg"
          parts.push({ inline_data: { mime_type: mime, data: b64 } });
        }
      }
    }

    body.contents.push({
      role:  msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[Gemini Error]', res.status, JSON.stringify(err));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) throw new Error('응답을 가져올 수 없어요. (안전 필터 또는 빈 응답)');
  return candidate.content.parts.map(p => p.text || '').join('');
}

// ── OpenRouter / OpenAI-compatible ───────────────────────────
async function _callOpenAICompat({ model, system, messages }) {
  const payload = { model, messages: [] };
  if (system) payload.messages.push({ role: 'system', content: system });
  payload.messages.push(...messages);

  const res = await fetch(`${CONFIG.BASE_URL}/chat/completions`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[OpenRouter Error]', res.status, JSON.stringify(err));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data    = await res.json();
  if (!data.choices?.[0]?.message) throw new Error('응답을 가져올 수 없어요.');
  const content = data.choices[0].message.content;
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === 'string' ? p : p.text || '')).join('');
  }
  return content;
}

// Backward-compatible wrapper
async function callOpenRouter(messages, model = 'openai/gpt-4o-mini', system) {
  return callAI({ model, system, messages });
}
