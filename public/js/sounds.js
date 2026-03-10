/* ═══════════════════════════════════════════════════════════════════
   ROYAL KAT & KAI VAULT — Sound System (Web Audio API)
   Each theme has its own acoustic personality
═══════════════════════════════════════════════════════════════════ */

const SoundSystem = (() => {
  let ctx = null;
  let enabled = true;
  let theme = 'dark';

  const profiles = {
    kaliph: {
      keystroke: { type: 'sawtooth', freq: [180, 200, 220], dur: 0.04, gain: 0.07, detune: 100 },
      send:  { type: 'sine', freqs: [300, 400, 600], dur: 0.25, gain: 0.12 },
      recv:  { type: 'triangle', freqs: [800, 1000], dur: 0.3, gain: 0.1 },
      error: { type: 'sawtooth', freqs: [120, 90], dur: 0.2, gain: 0.1 },
      notif: { type: 'sine', freqs: [880, 1100, 880], dur: 0.4, gain: 0.12 },
    },
    kathrine: {
      keystroke: { type: 'sine', freq: [900, 1000, 850], dur: 0.06, gain: 0.04, detune: 0 },
      send:  { type: 'sine', freqs: [1046, 1318, 1568], dur: 0.3, gain: 0.08 },
      recv:  { type: 'sine', freqs: [1174, 1397], dur: 0.35, gain: 0.08 },
      error: { type: 'triangle', freqs: [400, 300], dur: 0.2, gain: 0.08 },
      notif: { type: 'sine', freqs: [1318, 1568, 1760], dur: 0.5, gain: 0.1 },
    },
    royal: {
      keystroke: { type: 'triangle', freq: [300, 320, 280], dur: 0.07, gain: 0.08, detune: 20 },
      send:  { type: 'triangle', freqs: [196, 247, 294], dur: 0.35, gain: 0.14 },
      recv:  { type: 'triangle', freqs: [261, 330], dur: 0.4, gain: 0.12 },
      error: { type: 'square', freqs: [150, 130], dur: 0.25, gain: 0.1 },
      notif: { type: 'triangle', freqs: [440, 554, 659], dur: 0.6, gain: 0.14 },
    },
    light: {
      keystroke: { type: 'square', freq: [600, 650, 700], dur: 0.02, gain: 0.04, detune: 0 },
      send:  { type: 'sine', freqs: [523, 659, 784], dur: 0.2, gain: 0.08 },
      recv:  { type: 'sine', freqs: [784, 988], dur: 0.25, gain: 0.07 },
      error: { type: 'square', freqs: [300, 250], dur: 0.15, gain: 0.07 },
      notif: { type: 'sine', freqs: [784, 988, 1175], dur: 0.4, gain: 0.09 },
    },
    dark: {
      keystroke: { type: 'sine', freq: [400, 420, 440], dur: 0.035, gain: 0.04, detune: 50 },
      send:  { type: 'sine', freqs: [392, 494, 587], dur: 0.22, gain: 0.09 },
      recv:  { type: 'sine', freqs: [587, 740], dur: 0.3, gain: 0.08 },
      error: { type: 'triangle', freqs: [200, 170], dur: 0.2, gain: 0.09 },
      notif: { type: 'sine', freqs: [659, 784, 988], dur: 0.4, gain: 0.1 },
    },
    heaven: {
      keystroke: { type: 'sine', freq: [1200, 1300, 1100], dur: 0.08, gain: 0.03, detune: 0 },
      send:  { type: 'sine', freqs: [1047, 1319, 1568, 2093], dur: 0.5, gain: 0.07 },
      recv:  { type: 'sine', freqs: [1174, 1568], dur: 0.55, gain: 0.06 },
      error: { type: 'sine', freqs: [600, 500], dur: 0.3, gain: 0.06 },
      notif: { type: 'sine', freqs: [1568, 2093, 2637], dur: 0.7, gain: 0.08 },
    },
  };

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone(freq, type, dur, gain, startTime) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gainNode = c.createGain();
    osc.connect(gainNode);
    gainNode.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.01);
  }

  function play(soundName) {
    if (!enabled) return;
    try {
      const p = profiles[theme] || profiles.dark;
      const s = p[soundName];
      if (!s) return;
      const c = getCtx();
      const now = c.currentTime;

      if (soundName === 'keystroke') {
        const freq = s.freq[Math.floor(Math.random() * s.freq.length)];
        const jitter = (Math.random() - 0.5) * s.detune;
        playTone(freq + jitter, s.type, s.dur, s.gain, now);
      } else if (s.freqs) {
        s.freqs.forEach((freq, i) => {
          playTone(freq, s.type, s.dur, s.gain * 0.8, now + i * (s.dur / s.freqs.length * 0.6));
        });
      }
    } catch {}
  }

  // ── Ringtone system ───────────────────────────────────────────────
  let ringtoneInterval = null;

  function playRingtonePulse(type) {
    const c = getCtx();
    const now = c.currentTime;
    if (type === 'outgoing') {
      // Gentle two-tone pulse (like a soft phone ring)
      playTone(440, 'sine', 0.4, 0.08, now);
      playTone(520, 'sine', 0.4, 0.06, now + 0.15);
    } else {
      // Incoming: slightly brighter three-note chime
      playTone(523, 'sine', 0.25, 0.1, now);
      playTone(659, 'sine', 0.25, 0.08, now + 0.2);
      playTone(784, 'sine', 0.35, 0.07, now + 0.4);
    }
  }

  function startRingtone(type) {
    stopRingtone();
    if (!enabled) return;
    playRingtonePulse(type);
    ringtoneInterval = setInterval(() => playRingtonePulse(type), type === 'outgoing' ? 2500 : 2000);
  }

  function stopRingtone() {
    if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
  }

  return {
    setTheme: (t) => { theme = t || 'dark'; },
    setEnabled: (v) => { enabled = v; },
    isEnabled: () => enabled,
    keystroke: () => play('keystroke'),
    send: () => play('send'),
    receive: () => play('recv'),
    error: () => play('error'),
    notify: () => play('notif'),
    startRingtone,
    stopRingtone,
    init: () => {
      // Warm up audio context on first interaction
      document.addEventListener('click', () => getCtx(), { once: true });
    }
  };
})();

SoundSystem.init();
