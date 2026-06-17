export function extractTradeProposalFromText(content, onError) {
  if (!content || typeof content !== 'string') return null;
  const labelIdx = content.indexOf('TRADE_PROPOSAL');
  let startIdx = -1;
  if (labelIdx !== -1) startIdx = content.indexOf('{', labelIdx);
  if (startIdx === -1) {
    const hint = content.indexOf('"propose_trade"');
    if (hint !== -1) startIdx = content.lastIndexOf('{', hint);
    else startIdx = content.indexOf('{');
  }
  if (startIdx === -1) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  let jsonString = content.slice(startIdx, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed = JSON.parse(jsonString);
    if (parsed?.action === 'propose_trade' && parsed?.trade_details) return parsed;
  } catch (e) {
    console.error('Failed to parse TRADE_PROPOSAL:', e);
    if (onError) onError();
  }
  return null;
}

export function speakTextChunked(text, settingsObj, onStart, onEnd) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  let cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`~_]/g, '')
    .trim();
  if (!cleaned) return;
  const chunks = [];
  let remaining = cleaned;
  while (remaining.length > 0) {
    if (remaining.length <= 280) { chunks.push(remaining); break; }
    let sp = remaining.lastIndexOf('. ', 280);
    if (sp < 80) sp = remaining.lastIndexOf('! ', 280);
    if (sp < 80) sp = remaining.lastIndexOf('? ', 280);
    if (sp < 80) sp = remaining.lastIndexOf(', ', 280);
    if (sp < 80) sp = 280; else sp += 2;
    chunks.push(remaining.slice(0, sp).trim());
    remaining = remaining.slice(sp).trim();
  }
  synth.cancel();
  if (onStart) onStart();
  const rateMap = { slow: 0.8, normal: 1.0, fast: 1.2 };
  const pitchMap = { slow: 0.9, normal: 1.0, fast: 1.2 };
  const rate = rateMap[settingsObj?.tts_speech_rate || 'normal'] ?? 1.0;
  const pitch = pitchMap[settingsObj?.tts_speech_pitch || 'normal'] ?? 1.0;
  const voices = synth.getVoices?.() || [];
  const voice = settingsObj?.tts_voice_uri ? voices.find(v => v.voiceURI === settingsObj.tts_voice_uri) || null : null;
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = rate;
    u.pitch = pitch;
    if (voice) u.voice = voice;
    if (i === chunks.length - 1) {
      u.onend = () => { if (onEnd) onEnd(); };
      u.onerror = () => { if (onEnd) onEnd(); };
    }
    synth.speak(u);
  });
}