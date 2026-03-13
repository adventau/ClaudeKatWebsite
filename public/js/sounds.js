/* ═══════════════════════════════════════════════════════════════════
   ROYAL KAT & KAI VAULT — Sound System (Web Audio API)
   Every theme has its own complete acoustic personality:
   keystrokes, send/recv, errors, notifications, ringtones & call sounds
═══════════════════════════════════════════════════════════════════ */

const SoundSystem = (() => {
  let ctx = null;
  let enabled = true;
  let theme = 'dark';

  // ═════════════════════════════════════════════════════════════════
  // THEME SOUND PROFILES — each theme gets unique audio character
  // ═════════════════════════════════════════════════════════════════

  const profiles = {

    // ── KALIPH: AVNT Purple — Cyber/tech, aggressive sawtooth, digital glitch ──
    kaliph: {
      keystroke:  { type: 'sawtooth', freq: [180, 200, 220], dur: 0.04, gain: 0.07, detune: 100 },
      send:       { type: 'sine', freqs: [300, 400, 600], dur: 0.25, gain: 0.12 },
      recv:       { type: 'triangle', freqs: [800, 1000], dur: 0.3, gain: 0.1 },
      error:      { type: 'sawtooth', freqs: [120, 90], dur: 0.2, gain: 0.1 },
      notif:      { type: 'sine', freqs: [880, 1100, 880], dur: 0.4, gain: 0.12 },
      navigate:   { type: 'sawtooth', freqs: [300, 500], dur: 0.08, gain: 0.05 },
      modal_open: { type: 'sine', freqs: [400, 600], dur: 0.1, gain: 0.06 },
      modal_close:{ type: 'sine', freqs: [500, 300], dur: 0.08, gain: 0.05 },
      toggle:     { type: 'sawtooth', freqs: [350, 450], dur: 0.06, gain: 0.05 },
      success:    { type: 'sine', freqs: [400, 600, 800], dur: 0.15, gain: 0.08 },
      delete_snd: { type: 'sawtooth', freqs: [350, 200], dur: 0.1, gain: 0.06 },
      ring_out:   { type: 'sine', freqs: [400, 500], dur: 0.4, gain: 0.08, gap: 0.15 },
      ring_in:    { type: 'sawtooth', freqs: [600, 750, 900], dur: 0.2, gain: 0.09, gap: 0.15 },
      hangup:     { type: 'sawtooth', freqs: [500, 300, 150], dur: 0.12, gain: 0.1 },
      mute:       { type: 'sawtooth', freqs: [250, 150], dur: 0.08, gain: 0.08 },
      unmute:     { type: 'sawtooth', freqs: [200, 350], dur: 0.08, gain: 0.08 },
      share_on:   { type: 'sine', freqs: [400, 600, 800], dur: 0.1, gain: 0.07 },
      share_off:  { type: 'sine', freqs: [600, 400], dur: 0.1, gain: 0.06 },
    },

    // ── KATHRINE: Royal Violet — Elegant, airy, high sparkle, gentle harp ──
    kathrine: {
      keystroke:  { type: 'sine', freq: [900, 1000, 850], dur: 0.06, gain: 0.04, detune: 0 },
      send:       { type: 'sine', freqs: [1046, 1318, 1568], dur: 0.3, gain: 0.08 },
      recv:       { type: 'sine', freqs: [1174, 1397], dur: 0.35, gain: 0.08 },
      error:      { type: 'triangle', freqs: [400, 300], dur: 0.2, gain: 0.08 },
      notif:      { type: 'sine', freqs: [1318, 1568, 1760], dur: 0.5, gain: 0.1 },
      navigate:   { type: 'sine', freqs: [1047, 1319], dur: 0.1, gain: 0.04 },
      modal_open: { type: 'sine', freqs: [1174, 1568], dur: 0.15, gain: 0.05 },
      modal_close:{ type: 'sine', freqs: [1319, 988], dur: 0.1, gain: 0.04 },
      toggle:     { type: 'sine', freqs: [1047, 1319], dur: 0.08, gain: 0.04 },
      success:    { type: 'sine', freqs: [1047, 1319, 1568], dur: 0.2, gain: 0.06 },
      delete_snd: { type: 'sine', freqs: [988, 784], dur: 0.12, gain: 0.04 },
      ring_out:   { type: 'sine', freqs: [880, 1047], dur: 0.45, gain: 0.06, gap: 0.2 },
      ring_in:    { type: 'sine', freqs: [1047, 1319, 1568], dur: 0.25, gain: 0.08, gap: 0.18 },
      hangup:     { type: 'sine', freqs: [784, 523], dur: 0.18, gain: 0.07 },
      mute:       { type: 'sine', freqs: [523, 392], dur: 0.1, gain: 0.05 },
      unmute:     { type: 'sine', freqs: [523, 784], dur: 0.1, gain: 0.06 },
      share_on:   { type: 'sine', freqs: [784, 988, 1319], dur: 0.12, gain: 0.06 },
      share_off:  { type: 'sine', freqs: [988, 784], dur: 0.1, gain: 0.05 },
    },

    // ── ROYAL: Crimson Throne — Brass fanfare, regal triangle, bold ──
    royal: {
      keystroke:  { type: 'triangle', freq: [300, 320, 280], dur: 0.07, gain: 0.08, detune: 20 },
      send:       { type: 'triangle', freqs: [196, 247, 294], dur: 0.35, gain: 0.14 },
      recv:       { type: 'triangle', freqs: [261, 330], dur: 0.4, gain: 0.12 },
      error:      { type: 'square', freqs: [150, 130], dur: 0.25, gain: 0.1 },
      notif:      { type: 'triangle', freqs: [440, 554, 659], dur: 0.6, gain: 0.14 },
      navigate:   { type: 'triangle', freqs: [294, 370], dur: 0.1, gain: 0.06 },
      modal_open: { type: 'triangle', freqs: [330, 440], dur: 0.15, gain: 0.07 },
      modal_close:{ type: 'triangle', freqs: [370, 247], dur: 0.1, gain: 0.06 },
      toggle:     { type: 'triangle', freqs: [330, 440], dur: 0.08, gain: 0.06 },
      success:    { type: 'triangle', freqs: [294, 370, 440], dur: 0.18, gain: 0.08 },
      delete_snd: { type: 'triangle', freqs: [330, 220], dur: 0.12, gain: 0.06 },
      ring_out:   { type: 'triangle', freqs: [294, 370], dur: 0.5, gain: 0.1, gap: 0.2 },
      ring_in:    { type: 'triangle', freqs: [330, 415, 494, 554], dur: 0.3, gain: 0.12, gap: 0.12 },
      hangup:     { type: 'triangle', freqs: [370, 247, 196], dur: 0.2, gain: 0.1 },
      mute:       { type: 'triangle', freqs: [247, 196], dur: 0.12, gain: 0.08 },
      unmute:     { type: 'triangle', freqs: [247, 370], dur: 0.12, gain: 0.09 },
      share_on:   { type: 'triangle', freqs: [330, 440, 554], dur: 0.15, gain: 0.08 },
      share_off:  { type: 'triangle', freqs: [440, 330], dur: 0.12, gain: 0.07 },
    },

    // ── LIGHT: Pristine — Crisp clicks, clean sine, bright & minimal ──
    light: {
      keystroke:  { type: 'square', freq: [600, 650, 700], dur: 0.02, gain: 0.04, detune: 0 },
      send:       { type: 'sine', freqs: [523, 659, 784], dur: 0.2, gain: 0.08 },
      recv:       { type: 'sine', freqs: [784, 988], dur: 0.25, gain: 0.07 },
      error:      { type: 'square', freqs: [300, 250], dur: 0.15, gain: 0.07 },
      notif:      { type: 'sine', freqs: [784, 988, 1175], dur: 0.4, gain: 0.09 },
      navigate:   { type: 'sine', freqs: [659, 784], dur: 0.08, gain: 0.04 },
      modal_open: { type: 'sine', freqs: [784, 988], dur: 0.1, gain: 0.05 },
      modal_close:{ type: 'sine', freqs: [784, 587], dur: 0.08, gain: 0.04 },
      toggle:     { type: 'square', freqs: [600, 800], dur: 0.05, gain: 0.04 },
      success:    { type: 'sine', freqs: [659, 784, 988], dur: 0.15, gain: 0.06 },
      delete_snd: { type: 'square', freqs: [500, 350], dur: 0.1, gain: 0.05 },
      ring_out:   { type: 'sine', freqs: [659, 784], dur: 0.3, gain: 0.07, gap: 0.15 },
      ring_in:    { type: 'sine', freqs: [784, 988, 1175], dur: 0.2, gain: 0.08, gap: 0.15 },
      hangup:     { type: 'sine', freqs: [659, 440], dur: 0.12, gain: 0.07 },
      mute:       { type: 'square', freqs: [400, 300], dur: 0.06, gain: 0.05 },
      unmute:     { type: 'square', freqs: [400, 550], dur: 0.06, gain: 0.06 },
      share_on:   { type: 'sine', freqs: [659, 784, 988], dur: 0.1, gain: 0.06 },
      share_off:  { type: 'sine', freqs: [784, 659], dur: 0.08, gain: 0.05 },
    },

    // ── DARK: Midnight — Smooth, low sine, moody undertones ──
    dark: {
      keystroke:  { type: 'sine', freq: [400, 420, 440], dur: 0.035, gain: 0.04, detune: 50 },
      send:       { type: 'sine', freqs: [392, 494, 587], dur: 0.22, gain: 0.09 },
      recv:       { type: 'sine', freqs: [587, 740], dur: 0.3, gain: 0.08 },
      error:      { type: 'triangle', freqs: [200, 170], dur: 0.2, gain: 0.09 },
      notif:      { type: 'sine', freqs: [659, 784, 988], dur: 0.4, gain: 0.1 },
      navigate:   { type: 'sine', freqs: [440, 523], dur: 0.08, gain: 0.04 },
      modal_open: { type: 'sine', freqs: [494, 659], dur: 0.12, gain: 0.05 },
      modal_close:{ type: 'sine', freqs: [587, 392], dur: 0.08, gain: 0.04 },
      toggle:     { type: 'sine', freqs: [440, 587], dur: 0.06, gain: 0.04 },
      success:    { type: 'sine', freqs: [494, 587, 740], dur: 0.15, gain: 0.06 },
      delete_snd: { type: 'triangle', freqs: [400, 250], dur: 0.1, gain: 0.05 },
      ring_out:   { type: 'sine', freqs: [440, 520], dur: 0.4, gain: 0.08, gap: 0.15 },
      ring_in:    { type: 'sine', freqs: [523, 659, 784], dur: 0.25, gain: 0.1, gap: 0.2 },
      hangup:     { type: 'sine', freqs: [480, 320], dur: 0.15, gain: 0.08 },
      mute:       { type: 'sine', freqs: [200, 150], dur: 0.1, gain: 0.08 },
      unmute:     { type: 'sine', freqs: [300, 450], dur: 0.08, gain: 0.07 },
      share_on:   { type: 'sine', freqs: [523, 659, 784], dur: 0.12, gain: 0.07 },
      share_off:  { type: 'sine', freqs: [659, 523], dur: 0.1, gain: 0.06 },
    },

    // ── NEON: Neon Tokyo — Aggressive square waves, glitchy bitcrushed, cyberpunk arcade ──
    neon: {
      keystroke:  { type: 'square', freq: [220, 260, 200], dur: 0.025, gain: 0.05, detune: 150 },
      send:       { type: 'square', freqs: [330, 440, 660, 880], dur: 0.18, gain: 0.09 },
      recv:       { type: 'sawtooth', freqs: [880, 660], dur: 0.2, gain: 0.08 },
      error:      { type: 'square', freqs: [110, 80, 60], dur: 0.15, gain: 0.1 },
      notif:      { type: 'square', freqs: [660, 880, 1100, 1320], dur: 0.3, gain: 0.08 },
      navigate:   { type: 'square', freqs: [440, 660], dur: 0.05, gain: 0.05 },
      modal_open: { type: 'sawtooth', freqs: [220, 440, 660], dur: 0.08, gain: 0.06 },
      modal_close:{ type: 'sawtooth', freqs: [660, 330], dur: 0.06, gain: 0.05 },
      toggle:     { type: 'square', freqs: [440, 550], dur: 0.04, gain: 0.05 },
      success:    { type: 'square', freqs: [440, 660, 880, 1100], dur: 0.1, gain: 0.07 },
      delete_snd: { type: 'sawtooth', freqs: [440, 220, 110], dur: 0.08, gain: 0.06 },
      ring_out:   { type: 'square', freqs: [440, 550], dur: 0.3, gain: 0.07, gap: 0.12 },
      ring_in:    { type: 'square', freqs: [660, 880, 1100, 1320], dur: 0.15, gain: 0.08, gap: 0.1 },
      hangup:     { type: 'sawtooth', freqs: [660, 330, 110], dur: 0.1, gain: 0.09 },
      mute:       { type: 'square', freqs: [330, 220], dur: 0.06, gain: 0.06 },
      unmute:     { type: 'square', freqs: [220, 440], dur: 0.06, gain: 0.07 },
      share_on:   { type: 'square', freqs: [440, 660, 880], dur: 0.08, gain: 0.06 },
      share_off:  { type: 'square', freqs: [660, 440], dur: 0.06, gain: 0.05 },
    },

    // ── NOIR: Velvet Noir — Warm jazz piano, smoky lounge, mellow triangle, noir brass ──
    noir: {
      keystroke:  { type: 'triangle', freq: [277, 311, 262], dur: 0.07, gain: 0.06, detune: 8 },
      send:       { type: 'triangle', freqs: [262, 330, 392, 494], dur: 0.4, gain: 0.1 },
      recv:       { type: 'sine', freqs: [370, 466], dur: 0.45, gain: 0.09 },
      error:      { type: 'triangle', freqs: [175, 147, 131], dur: 0.3, gain: 0.09 },
      notif:      { type: 'triangle', freqs: [466, 554, 659, 740], dur: 0.55, gain: 0.1 },
      navigate:   { type: 'triangle', freqs: [330, 415], dur: 0.1, gain: 0.05 },
      modal_open: { type: 'sine', freqs: [277, 370, 466], dur: 0.18, gain: 0.06 },
      modal_close:{ type: 'sine', freqs: [415, 277], dur: 0.12, gain: 0.05 },
      toggle:     { type: 'triangle', freqs: [330, 415], dur: 0.08, gain: 0.05 },
      success:    { type: 'triangle', freqs: [330, 415, 494, 554], dur: 0.2, gain: 0.07 },
      delete_snd: { type: 'triangle', freqs: [370, 247], dur: 0.15, gain: 0.06 },
      ring_out:   { type: 'triangle', freqs: [277, 370], dur: 0.55, gain: 0.08, gap: 0.25 },
      ring_in:    { type: 'triangle', freqs: [370, 466, 554, 659], dur: 0.3, gain: 0.09, gap: 0.2 },
      hangup:     { type: 'triangle', freqs: [415, 277, 208], dur: 0.25, gain: 0.08 },
      mute:       { type: 'triangle', freqs: [277, 208], dur: 0.12, gain: 0.06 },
      unmute:     { type: 'triangle', freqs: [277, 415], dur: 0.12, gain: 0.07 },
      share_on:   { type: 'triangle', freqs: [330, 415, 494], dur: 0.15, gain: 0.07 },
      share_off:  { type: 'triangle', freqs: [415, 330], dur: 0.12, gain: 0.06 },
    },

    // ── ROSEWOOD: Rose & Ember — Warm, intimate, soft plucks, cozy hearth ──
    rosewood: {
      keystroke:  { type: 'sine', freq: [520, 550, 490], dur: 0.05, gain: 0.05, detune: 10 },
      send:       { type: 'sine', freqs: [349, 440, 523], dur: 0.3, gain: 0.09 },
      recv:       { type: 'triangle', freqs: [440, 554], dur: 0.35, gain: 0.08 },
      error:      { type: 'triangle', freqs: [220, 185], dur: 0.22, gain: 0.08 },
      notif:      { type: 'sine', freqs: [554, 659, 784], dur: 0.45, gain: 0.1 },
      navigate:   { type: 'sine', freqs: [440, 523], dur: 0.08, gain: 0.04 },
      modal_open: { type: 'sine', freqs: [523, 659], dur: 0.12, gain: 0.05 },
      modal_close:{ type: 'sine', freqs: [554, 370], dur: 0.08, gain: 0.04 },
      toggle:     { type: 'triangle', freqs: [440, 554], dur: 0.07, gain: 0.04 },
      success:    { type: 'sine', freqs: [440, 554, 659], dur: 0.15, gain: 0.06 },
      delete_snd: { type: 'triangle', freqs: [440, 294], dur: 0.1, gain: 0.05 },
      ring_out:   { type: 'sine', freqs: [440, 554], dur: 0.45, gain: 0.07, gap: 0.2 },
      ring_in:    { type: 'sine', freqs: [554, 659, 784], dur: 0.28, gain: 0.08, gap: 0.18 },
      hangup:     { type: 'sine', freqs: [523, 349], dur: 0.18, gain: 0.07 },
      mute:       { type: 'triangle', freqs: [330, 262], dur: 0.1, gain: 0.06 },
      unmute:     { type: 'triangle', freqs: [330, 494], dur: 0.1, gain: 0.07 },
      share_on:   { type: 'sine', freqs: [440, 554, 659], dur: 0.12, gain: 0.06 },
      share_off:  { type: 'sine', freqs: [554, 440], dur: 0.1, gain: 0.05 },
    },

    // ── OCEAN: Deep Tide — Flowing, deep, watery resonance, whale-call ──
    ocean: {
      keystroke:  { type: 'sine', freq: [680, 720, 640], dur: 0.045, gain: 0.04, detune: 30 },
      send:       { type: 'sine', freqs: [262, 330, 392, 494], dur: 0.35, gain: 0.09 },
      recv:       { type: 'sine', freqs: [196, 262], dur: 0.45, gain: 0.08 },
      error:      { type: 'sine', freqs: [165, 131], dur: 0.3, gain: 0.09 },
      notif:      { type: 'sine', freqs: [392, 494, 587, 659], dur: 0.55, gain: 0.1 },
      navigate:   { type: 'sine', freqs: [330, 392], dur: 0.1, gain: 0.04 },
      modal_open: { type: 'sine', freqs: [262, 392], dur: 0.15, gain: 0.05 },
      modal_close:{ type: 'sine', freqs: [392, 262], dur: 0.1, gain: 0.04 },
      toggle:     { type: 'sine', freqs: [330, 440], dur: 0.08, gain: 0.04 },
      success:    { type: 'sine', freqs: [330, 440, 554], dur: 0.18, gain: 0.06 },
      delete_snd: { type: 'sine', freqs: [330, 196], dur: 0.12, gain: 0.05 },
      ring_out:   { type: 'sine', freqs: [262, 330], dur: 0.55, gain: 0.07, gap: 0.25 },
      ring_in:    { type: 'sine', freqs: [330, 392, 494, 587], dur: 0.3, gain: 0.08, gap: 0.2 },
      hangup:     { type: 'sine', freqs: [392, 262, 196], dur: 0.22, gain: 0.08 },
      mute:       { type: 'sine', freqs: [262, 196], dur: 0.15, gain: 0.06 },
      unmute:     { type: 'sine', freqs: [262, 392], dur: 0.12, gain: 0.07 },
      share_on:   { type: 'sine', freqs: [330, 440, 554], dur: 0.15, gain: 0.06 },
      share_off:  { type: 'sine', freqs: [440, 330], dur: 0.12, gain: 0.05 },
    },

    // ── FOREST: Enchanted Forest — Mystical, earthy, wind chimes, fairy dust ──
    forest: {
      keystroke:  { type: 'triangle', freq: [350, 380, 320], dur: 0.055, gain: 0.06, detune: 15 },
      send:       { type: 'sine', freqs: [523, 659, 784, 1047], dur: 0.35, gain: 0.09 },
      recv:       { type: 'triangle', freqs: [294, 392], dur: 0.4, gain: 0.09 },
      error:      { type: 'triangle', freqs: [185, 147], dur: 0.18, gain: 0.09 },
      notif:      { type: 'sine', freqs: [784, 988, 1175, 1319], dur: 0.55, gain: 0.1 },
      navigate:   { type: 'triangle', freqs: [392, 523], dur: 0.1, gain: 0.05 },
      modal_open: { type: 'sine', freqs: [523, 784], dur: 0.15, gain: 0.05 },
      modal_close:{ type: 'sine', freqs: [659, 440], dur: 0.1, gain: 0.04 },
      toggle:     { type: 'triangle', freqs: [392, 523], dur: 0.08, gain: 0.05 },
      success:    { type: 'sine', freqs: [523, 659, 784], dur: 0.18, gain: 0.06 },
      delete_snd: { type: 'triangle', freqs: [392, 247], dur: 0.12, gain: 0.05 },
      ring_out:   { type: 'triangle', freqs: [392, 494], dur: 0.5, gain: 0.08, gap: 0.2 },
      ring_in:    { type: 'sine', freqs: [659, 784, 988, 1175], dur: 0.28, gain: 0.09, gap: 0.16 },
      hangup:     { type: 'triangle', freqs: [494, 330, 247], dur: 0.2, gain: 0.08 },
      mute:       { type: 'triangle', freqs: [294, 220], dur: 0.1, gain: 0.07 },
      unmute:     { type: 'triangle', freqs: [294, 440], dur: 0.1, gain: 0.08 },
      share_on:   { type: 'sine', freqs: [523, 659, 784], dur: 0.13, gain: 0.07 },
      share_off:  { type: 'sine', freqs: [659, 523], dur: 0.1, gain: 0.06 },
    },
  };

  // ═════════════════════════════════════════════════════════════════
  // AUDIO ENGINE
  // ═════════════════════════════════════════════════════════════════

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

  // Play a sequence of tones from a sound definition
  function playSequence(s, now) {
    if (!s || !s.freqs) return;
    const spacing = s.gap || (s.dur / s.freqs.length * 0.6);
    s.freqs.forEach((freq, i) => {
      playTone(freq, s.type, s.dur, s.gain * 0.8, now + i * spacing);
    });
  }

  // Get the current theme's profile (fallback to dark)
  function getProfile() {
    return profiles[theme] || profiles.dark;
  }

  // ── Throttle keystrokes ───────────────────────────────────────────
  let lastKeystrokeTime = 0;
  const KEYSTROKE_MIN_INTERVAL = 30;

  function play(soundName) {
    if (!enabled) return;
    try {
      const p = getProfile();
      const s = p[soundName];
      if (!s) return;
      const c = getCtx();
      const now = c.currentTime;

      if (soundName === 'keystroke') {
        const t = performance.now();
        if (t - lastKeystrokeTime < KEYSTROKE_MIN_INTERVAL) return;
        lastKeystrokeTime = t;
        const freq = s.freq[Math.floor(Math.random() * s.freq.length)];
        const jitter = (Math.random() - 0.5) * s.detune;
        playTone(freq + jitter, s.type, s.dur, s.gain, now);
      } else if (s.freqs) {
        playSequence(s, now);
      }
    } catch {}
  }

  // ═════════════════════════════════════════════════════════════════
  // RINGTONE SYSTEM — theme-aware
  // ═════════════════════════════════════════════════════════════════
  let ringtoneInterval = null;

  function playRingtonePulse(type) {
    if (!enabled) return;
    try {
      const p = getProfile();
      const c = getCtx();
      const now = c.currentTime;
      const s = type === 'outgoing' ? p.ring_out : p.ring_in;
      if (s && s.freqs) {
        playSequence(s, now);
      }
    } catch {}
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

  // ═════════════════════════════════════════════════════════════════
  // CALL ACTION SOUNDS — theme-aware
  // ═════════════════════════════════════════════════════════════════
  function playCallSound(action) {
    if (!enabled) return;
    try {
      const p = getProfile();
      const c = getCtx();
      const now = c.currentTime;

      const map = {
        'hangup':          p.hangup,
        'mute':            p.mute,
        'unmute':          p.unmute,
        'screenshare-on':  p.share_on,
        'screenshare-off': p.share_off,
      };

      const s = map[action];
      if (s && s.freqs) {
        playSequence(s, now);
      }
    } catch {}
  }

  // ═════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═════════════════════════════════════════════════════════════════
  return {
    setTheme: (t) => { theme = t || 'dark'; },
    setEnabled: (v) => { enabled = v; },
    isEnabled: () => enabled,
    keystroke: () => play('keystroke'),
    send: () => play('send'),
    receive: () => play('recv'),
    error: () => play('error'),
    notify: () => play('notif'),
    navigate: () => play('navigate'),
    modalOpen: () => play('modal_open'),
    modalClose: () => play('modal_close'),
    toggle: () => play('toggle'),
    success: () => play('success'),
    deleteSnd: () => play('delete_snd'),
    startRingtone,
    stopRingtone,
    callSound: playCallSound,
    init: () => {
      // Warm up audio context on first interaction
      document.addEventListener('click', () => getCtx(), { once: true });
    }
  };
})();

SoundSystem.init();
