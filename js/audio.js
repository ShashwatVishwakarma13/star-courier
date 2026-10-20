/* Star Courier sound. Every effect and the music loop are synthesised with the Web Audio API, so there are no audio files to load. */
window.SCAudio = (() => {
  'use strict';

  const MASTER_VOLUME = 0.55;

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuffer = null;
  let muted = false;

  const music = { on: false, paused: false, step: 0, next: 0, tempo: 100, level: 0 };

  function init() {
    if (ctx) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      ctx = new AudioCtx();
    } catch (err) {
      return false;
    }
    const limiter = ctx.createDynamicsCompressor();
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(limiter);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.16;
    musicBus.connect(master);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  // Browsers keep audio blocked until a click or key press, so this is called from those handlers.
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone({ freq, to, dur, type = 'sine', vol = 0.2, at, delay = 0, attack = 0.005, bus = sfxBus }) {
    const t = (at ?? ctx.currentTime) + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise({ dur, vol = 0.2, filter = 'lowpass', freq = 1000, to, at, delay = 0, bus = sfxBus }) {
    const t = (at ?? ctx.currentTime) + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.setValueAtTime(freq, t);
    if (to) biquad.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(biquad);
    biquad.connect(gain);
    gain.connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  const arpeggio = (notes, step, opts) => notes.forEach((freq, i) => tone({ freq, delay: i * step, ...opts }));

  const effects = {
    pickup(combo = 1) {
      // Each combo step raises the pitch by a whole tone, so chains sound like they are climbing.
      const f = 620 * Math.pow(2, ((Math.min(combo, 5) - 1) * 2) / 12);
      tone({ freq: f, to: f * 1.5, dur: 0.1, type: 'square', vol: 0.08 });
      tone({ freq: f * 2, dur: 0.18, vol: 0.12, delay: 0.05 });
    },
    power() {
      arpeggio([523.25, 659.25, 783.99, 1046.5], 0.055, { dur: 0.14, type: 'triangle', vol: 0.16 });
    },
    dash() {
      noise({ dur: 0.2, vol: 0.22, filter: 'bandpass', freq: 500, to: 3000 });
    },
    hit() {
      noise({ dur: 0.35, vol: 0.45, freq: 1400, to: 150 });
      tone({ freq: 180, to: 45, dur: 0.35, type: 'sawtooth', vol: 0.18 });
    },
    shield() {
      tone({ freq: 1100, to: 280, dur: 0.3, type: 'triangle', vol: 0.2 });
      noise({ dur: 0.2, vol: 0.14, filter: 'highpass', freq: 2500 });
    },
    tick(secondsLeft) {
      tone({ freq: secondsLeft <= 3 ? 1320 : 990, dur: 0.07, type: 'square', vol: 0.05 });
    },
    levelClear() {
      arpeggio([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.085, { dur: 0.3, type: 'triangle', vol: 0.15 });
    },
    explode() {
      noise({ dur: 1.1, vol: 0.55, freq: 900, to: 50 });
      tone({ freq: 95, to: 28, dur: 0.9, vol: 0.4 });
    },
    gameOver() {
      arpeggio([392, 329.63, 261.63, 196], 0.2, { dur: 0.4, type: 'triangle', vol: 0.15, at: ctx.currentTime + 0.25 });
    },
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
      notes.forEach((freq, i) => tone({ freq, dur: i === notes.length - 1 ? 0.8 : 0.22, type: 'triangle', vol: 0.15, delay: i * 0.12 }));
    },
  };

  function play(name, arg) {
    if (!ctx || muted || ctx.state !== 'running') return;
    const fx = effects[name];
    if (fx) fx(arg);
  }

  // Music: Am, F, C, G (one bar each) as eighth-note arpeggios over a sine bass. Later levels add a hi-hat and play faster.
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const ARP = [0, 1, 2, 1, 2, 1, 0, 1];
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function scheduleStep(step, t, len) {
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    const i = step % 8;
    const note = chord[ARP[i]] + 12 + (i === 4 ? 12 : 0);
    tone({ freq: midi(note), dur: len * 0.9, type: 'triangle', vol: 0.5, at: t, bus: musicBus });
    if (i === 0 || i === 4) tone({ freq: midi(chord[0] - 12), dur: len * 3.6, vol: 0.9, at: t, attack: 0.02, bus: musicBus });
    if (music.level >= 2 && i % 2 === 1) noise({ dur: 0.05, vol: 0.18, filter: 'highpass', freq: 7000, at: t, bus: musicBus });
  }

  function startMusic(level) {
    if (!ctx) return;
    music.on = true;
    music.paused = false;
    music.level = level;
    music.tempo = 96 + level * 8;
    music.step = 0;
    music.next = ctx.currentTime + 0.12;
  }

  function stopMusic() {
    music.on = false;
  }

  function pauseMusic() {
    music.paused = true;
  }

  function resumeMusic() {
    if (!ctx || !music.on) return;
    music.paused = false;
    music.next = ctx.currentTime + 0.05;
  }

  // Called every frame: schedules the notes that fall in the next 0.2 s.
  function tick() {
    if (!ctx || !music.on || music.paused || muted || ctx.state !== 'running') return;
    const len = 60 / music.tempo / 2;
    if (music.next < ctx.currentTime - 0.25) music.next = ctx.currentTime + 0.05; // fell behind, e.g. the tab was hidden
    while (music.next < ctx.currentTime + 0.2) {
      scheduleStep(music.step, music.next, len);
      music.next += len;
      music.step++;
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (!master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.03);
  }

  return {
    unlock,
    play,
    startMusic,
    stopMusic,
    pauseMusic,
    resumeMusic,
    tick,
    setMuted,
    isMuted: () => muted,
  };
})();
