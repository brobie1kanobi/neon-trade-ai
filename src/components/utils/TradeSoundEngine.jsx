/**
 * TradeSoundEngine - Procedurally generates cyberpunk-style trade sounds
 * using the Web Audio API. No external files needed for defaults.
 * Also supports custom user-uploaded sound URLs.
 */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ── Built-in cyberpunk sound generators ──

function playBuySound(volume = 0.5) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.02);
  gain.gain.linearRampToValueAtTime(volume * 0.3, now + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

  // Rising dual-tone: neon confirmation
  [520, 780].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq * 0.7, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.12);
    osc.frequency.setValueAtTime(freq, now + 0.15);
    osc.connect(gain);
    osc.start(now + i * 0.06);
    osc.stop(now + 0.6);
  });

  // High sparkle accent
  const sparkle = ctx.createOscillator();
  sparkle.type = 'sine';
  sparkle.frequency.setValueAtTime(1560, now + 0.12);
  const sparkGain = ctx.createGain();
  sparkGain.connect(ctx.destination);
  sparkGain.gain.setValueAtTime(0, now + 0.12);
  sparkGain.gain.linearRampToValueAtTime(volume * 0.15, now + 0.14);
  sparkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  sparkle.connect(sparkGain);
  sparkle.start(now + 0.12);
  sparkle.stop(now + 0.35);
}

function playSellSound(volume = 0.5) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.35, now + 0.02);
  gain.gain.linearRampToValueAtTime(volume * 0.25, now + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

  // Descending tone: digital exit pulse
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.exponentialRampToValueAtTime(330, now + 0.3);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, now);
  filter.frequency.exponentialRampToValueAtTime(400, now + 0.4);
  filter.Q.value = 5;

  osc.connect(filter);
  filter.connect(gain);
  osc.start(now);
  osc.stop(now + 0.55);

  // Sub-bass thud
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, now);
  sub.frequency.exponentialRampToValueAtTime(60, now + 0.2);
  const subGain = ctx.createGain();
  subGain.connect(ctx.destination);
  subGain.gain.setValueAtTime(volume * 0.3, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  sub.connect(subGain);
  sub.start(now);
  sub.stop(now + 0.25);
}

function playTakeProfitSound(volume = 0.5) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Triumphant arpeggio: C5 → E5 → G5
  [523, 659, 784].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t = now + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

function playStopLossSound(volume = 0.5) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Warning descent: two quick falling tones
  [440, 330].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now + i * 0.12);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + i * 0.12 + 0.15);
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t = now + i * 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function playAlertSound(volume = 0.5) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Quick double-ping notification
  [880, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t = now + i * 0.1;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.08);
  });
}

// ── URL-based sound player (for custom uploads) ──
const audioCache = {};

async function playFromUrl(url, volume = 0.5) {
  if (!url) return;
  try {
    if (!audioCache[url]) {
      audioCache[url] = new Audio(url);
    }
    const audio = audioCache[url];
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.currentTime = 0;
    await audio.play();
  } catch (e) {
    console.warn('[TradeSoundEngine] Failed to play URL sound:', e.message);
  }
}

// ── Built-in sound map ──
const BUILT_IN_SOUNDS = {
  buy: playBuySound,
  sell: playSellSound,
  take_profit: playTakeProfitSound,
  stop_loss: playStopLossSound,
  alert: playAlertSound
};

/**
 * Play a trade sound effect.
 * @param {'buy'|'sell'|'take_profit'|'stop_loss'|'alert'} trigger
 * @param {object} settings - UserSettings object
 */
export function playTradeSound(trigger, settings) {
  if (!settings || settings.sound_enabled === false) return;

  const volume = settings.sound_volume ?? 0.5;

  // Check for custom URL first
  const urlMap = {
    buy: settings.sound_buy_url,
    sell: settings.sound_sell_url,
    take_profit: settings.sound_tp_url,
    stop_loss: settings.sound_sl_url,
    alert: settings.sound_alert_url
  };

  const customUrl = urlMap[trigger];
  if (customUrl) {
    playFromUrl(customUrl, volume);
    return;
  }

  // Fall back to built-in cyberpunk sound
  const builtIn = BUILT_IN_SOUNDS[trigger];
  if (builtIn) {
    builtIn(volume);
  }
}

/**
 * Preview a specific built-in sound (ignores custom URLs).
 */
export function previewBuiltInSound(trigger, volume = 0.5) {
  const builtIn = BUILT_IN_SOUNDS[trigger];
  if (builtIn) builtIn(volume);
}

export const SOUND_TRIGGERS = [
  { key: 'buy', label: 'Buy Executed', settingKey: 'sound_buy_url', icon: '🟢' },
  { key: 'sell', label: 'Sell Executed', settingKey: 'sound_sell_url', icon: '🔴' },
  { key: 'take_profit', label: 'Take Profit Hit', settingKey: 'sound_tp_url', icon: '🎯' },
  { key: 'stop_loss', label: 'Stop Loss Hit', settingKey: 'sound_sl_url', icon: '🛑' },
  { key: 'alert', label: 'Signal Alert', settingKey: 'sound_alert_url', icon: '🔔' }
];