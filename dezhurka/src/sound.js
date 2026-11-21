/* Дежурная часть — звук без файлов: короткие синтезированные шумы (WebAudio).
   Контекст создаётся при первом звуке, то есть уже после нажатия игрока. */
(function (root) {
  const DZ = (root.DZ = root.DZ || {});
  let ctx = null;
  let on = true;

  function audio() {
    if (!ctx) {
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function noise(c, t, dur, type, freq, peak, q) {
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q || 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function tone(c, t, dur, type, f0, f1, peak) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    tick(c, t) { tone(c, t, 0.04, 'square', 900, 700, 0.03); },
    paper(c, t) { noise(c, t, 0.16, 'bandpass', 3200, 0.07, 0.6); noise(c, t + 0.05, 0.12, 'bandpass', 2200, 0.05, 0.6); },
    drop(c, t) {
      [0, 0.07, 0.13, 0.22].forEach((d, i) => {
        tone(c, t + d, 0.09, 'sine', 170 - i * 18, 70, 0.16);
        noise(c, t + d, 0.05, 'lowpass', 1400, 0.09);
      });
    },
    stamp(c, t) { tone(c, t, 0.2, 'sine', 120, 42, 0.5); noise(c, t, 0.07, 'lowpass', 600, 0.3); },
    door(c, t) { tone(c, t, 0.28, 'sine', 90, 44, 0.32); noise(c, t, 0.12, 'lowpass', 320, 0.2); noise(c, t + 0.3, 0.05, 'bandpass', 1800, 0.05, 2); },
    clank(c, t) {
      [0, 0.26].forEach((d, i) => {
        const k = i ? 0.5 : 1;
        [523, 811, 1307, 1973].forEach((f, j) => tone(c, t + d, 0.5 - j * 0.07, 'triangle', f, f * 0.995, 0.07 * k));
        noise(c, t + d, 0.09, 'highpass', 2600, 0.12 * k);
        tone(c, t + d, 0.16, 'sine', 140, 60, 0.25 * k);
      });
    },
  };

  DZ.sound = {
    play(name) {
      if (!on || !SOUNDS[name]) return;
      const c = audio();
      if (!c) return;
      try { SOUNDS[name](c, c.currentTime + 0.01); } catch (e) { /* звук не обязателен */ }
    },
    set(value) { on = !!value; },
    isOn() { return on; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
