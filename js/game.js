/* Star Courier: game state, entities, input, rendering and screens. */
(() => {
  'use strict';

  const LEVELS = window.SC_LEVELS;
  const audio = window.SCAudio;

  // ---- Tuning ---------------------------------------------------------------
  const TAU = Math.PI * 2;
  const WORLD_AREA = 960 * 600; // the playfield is scaled so every screen holds about this much space,
  const MIN_SIDE = 420;         // and is never shorter than this in either direction
  const START_LIVES = 3;
  const MAX_LIVES = 5;
  const CORE_POINTS = 10;
  const COMBO_WINDOW = 2.5;     // seconds allowed between pickups to keep a combo going
  const COMBO_MAX = 5;
  const TIME_BONUS = 5;         // points per second left when a level is cleared
  const FLAWLESS_BONUS = 100;   // for clearing a level without being hit
  const TIME_PICKUP = 8;        // seconds added by the clock power-up
  const READY_TIME = 1.8;       // level intro before the clock starts
  const JOY_RADIUS = 56;        // touch joystick radius, in CSS pixels
  const SHIP = {
    r: 14,
    accel: 1500,
    maxSpeed: 310,
    dashSpeed: 820,
    dashTime: 0.18,
    dashCooldown: 1.4,
    invuln: 2,
    knockback: 380,
  };
  const POWER = {
    shield: { color: '#5ee0ff', sprite: 'cyan' },
    time: { color: '#7dffb2', sprite: 'green' },
    life: { color: '#ff7eb6', sprite: 'pink' },
  };
  const BEST_KEY = 'starCourier.best';
  const MUTE_KEY = 'starCourier.muted';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Helpers --------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const mod = (v, m) => ((v % m) + m) % m;
  const grow = (age) => 1 - Math.pow(1 - Math.min(1, age / 0.3), 3); // pop-in scale for new pickups

  function turnToward(angle, target, t) {
    const diff = mod(target - angle + Math.PI, TAU) - Math.PI;
    return angle + diff * t;
  }

  // localStorage can be missing or throw (private windows, blocked storage); the game works without it.
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage unavailable */
    }
  }

  // ---- DOM ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    hud: $('hud'),
    score: $('hud-score'),
    level: $('hud-level'),
    cores: $('hud-cores'),
    bar: $('hud-bar'),
    time: $('hud-time'),
    lives: $('hud-lives'),
    pauseBtn: $('btn-pause'),
    muteBtn: $('btn-mute'),
    dashBtn: $('btn-dash'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bannerTip: $('banner-tip'),
    combo: $('combo'),
    startBest: $('start-best'),
    levelTitle: $('level-title'),
    levelStats: $('level-stats'),
    levelNext: $('level-next'),
    nextBtn: $('btn-next'),
    endScreen: $('screen-end'),
    endTitle: $('end-title'),
    endReason: $('end-reason'),
    endScore: $('end-score'),
    endNew: $('end-new'),
    endStats: $('end-stats'),
  };
  const screens = {
    menu: $('screen-start'),
    paused: $('screen-pause'),
    levelclear: $('screen-level'),
    over: ui.endScreen,
    win: ui.endScreen,
  };
  const allScreens = [...new Set(Object.values(screens))];

  // ---- State ----------------------------------------------------------------
  // Game states: menu -> ready -> playing -> (paused) -> levelclear -> ready ... -> win
  //                                       \-> dying -> over        \-> over (time ran out)
  const view = { w: 960, h: 600, k: 1, dpr: 1, top: 64 };
  const game = {
    state: 'menu',
    levelIndex: 0,
    score: 0,
    best: 0,
    lives: START_LIVES,
    totalCores: 0,
    collected: 0,
    timeLeft: 0,
    lastTick: 0,
    combo: 0,
    comboTimer: 0,
    hits: 0,
    powerTimer: 0,
    readyTimer: 0,
    goTimer: 0,
    dyingTimer: 0,
    pausedFrom: 'playing',
    lockUntil: 0,
    lastClear: null,
    shake: 0,
    clock: 0,
  };
  let player = null;
  let cores = [];
  let asteroids = [];
  let seekers = [];
  let powerups = [];
  let particles = [];
  let texts = [];
  let stars = [];
  let background = null;

  // ---- Input ----------------------------------------------------------------
  const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  const DASH_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);
  const keys = new Set();
  const input = { x: 0, y: 0 };
  const pointer = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };

  const inputUnlocked = () => performance.now() >= game.lockUntil;

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = game.state;
    const inPlay = s === 'playing' || s === 'ready';
    if (MOVE_KEYS.has(e.code) || DASH_KEYS.has(e.code)) {
      if (inPlay) e.preventDefault();
      keys.add(e.code);
    }
    if (e.repeat) return;
    if (DASH_KEYS.has(e.code) && s === 'playing') {
      requestDash();
      return;
    }
    // A focused button handles its own Enter; acting here too would fire twice.
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    switch (e.code) {
      case 'KeyP':
      case 'Escape':
        if (inPlay) pause();
        else if (s === 'paused') resume();
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'KeyR':
        if ((s === 'paused' || s === 'over' || s === 'win') && inputUnlocked()) startGame();
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (onButton || !inputUnlocked()) break;
        if (s === 'menu' || s === 'over' || s === 'win') startGame();
        else if (s === 'levelclear') nextLevel();
        else if (s === 'paused') resume();
        break;
      default:
        break;
    }
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // Touch or mouse: press anywhere and drag to steer. The joystick follows the finger if it drifts too far.
  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'playing' && game.state !== 'ready') return;
    e.preventDefault();
    if (pointer.active && e.pointerId !== pointer.id) {
      requestDash(); // a second finger dashes
      return;
    }
    pointer.active = true;
    pointer.id = e.pointerId;
    pointer.ox = pointer.x = e.clientX;
    pointer.oy = pointer.y = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture is optional */
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointer.active || e.pointerId !== pointer.id) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    const dx = pointer.x - pointer.ox;
    const dy = pointer.y - pointer.oy;
    const d = Math.hypot(dx, dy);
    const leash = JOY_RADIUS * 1.25;
    if (d > leash) {
      pointer.ox = pointer.x - (dx / d) * leash;
      pointer.oy = pointer.y - (dy / d) * leash;
    }
  });

  const endPointer = (e) => {
    if (e.pointerId === pointer.id) pointer.active = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  ui.dashBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    requestDash();
  });

  function readInput() {
    let x = 0;
    let y = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
    if (x || y) {
      const len = Math.hypot(x, y);
      x /= len;
      y /= len;
    } else if (pointer.active) {
      const dx = pointer.x - pointer.ox;
      const dy = pointer.y - pointer.oy;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const m = Math.min(d, JOY_RADIUS) / JOY_RADIUS;
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    input.x = x;
    input.y = y;
  }

  window.addEventListener('blur', () => {
    keys.clear();
    pointer.active = false;
    pause();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // ---- Buttons --------------------------------------------------------------
  $('btn-start').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', startGame);
  $('btn-pause-menu').addEventListener('click', toMenu);
  ui.nextBtn.addEventListener('click', nextLevel);
  $('btn-again').addEventListener('click', startGame);
  $('btn-end-menu').addEventListener('click', toMenu);
  // HUD buttons give focus back straight away, so Space (dash) never re-presses them.
  ui.pauseBtn.addEventListener('click', () => {
    ui.pauseBtn.blur();
    if (game.state === 'paused') resume();
    else pause();
  });
  ui.muteBtn.addEventListener('click', () => {
    ui.muteBtn.blur();
    toggleMute();
  });
  for (const btn of document.querySelectorAll('.sound-text')) btn.addEventListener('click', toggleMute);

  function toggleMute() {
    audio.unlock();
    audio.setMuted(!audio.isMuted());
    save(MUTE_KEY, audio.isMuted());
    syncMute();
  }

  function syncMute() {
    const muted = audio.isMuted();
    ui.muteBtn.classList.toggle('muted', muted);
    ui.muteBtn.setAttribute('aria-pressed', String(muted));
    ui.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound (M)' : 'Mute sound (M)');
    for (const btn of document.querySelectorAll('.sound-text')) btn.textContent = muted ? 'Sound: off' : 'Sound: on';
  }

  // ---- Screens --------------------------------------------------------------
  let unlockTimer = 0;

  function setState(next) {
    game.state = next;
    document.body.dataset.state = next;
    const active = screens[next] || null;
    for (const el of allScreens) {
      const on = el === active;
      el.classList.toggle('active', on);
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
      for (const btn of el.querySelectorAll('button')) btn.disabled = true;
    }
    clearTimeout(unlockTimer);
    if (active) {
      // A short lock stops a held Space or Enter from skipping a screen the moment it appears.
      const delay = next === 'menu' ? 0 : 450;
      game.lockUntil = performance.now() + delay;
      unlockTimer = setTimeout(() => {
        for (const btn of active.querySelectorAll('button')) btn.disabled = false;
        const primary = active.querySelector('[data-primary]');
        if (primary) primary.focus({ preventScroll: true });
      }, delay);
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function showBanner(title, sub, tip) {
    ui.bannerTitle.textContent = title;
    ui.bannerSub.textContent = sub || '';
    ui.bannerTip.textContent = tip || '';
    ui.banner.classList.add('show');
  }

  function hideBanner() {
    ui.banner.classList.remove('show');
  }

  function showCombo(n) {
    ui.combo.textContent = `Combo ×${n}`;
    ui.combo.classList.remove('pop');
    void ui.combo.offsetWidth; // restart the CSS animation
    ui.combo.classList.add('pop');
  }

  function statRows(container, rows) {
    container.replaceChildren(
      ...rows.map(([label, value, cls]) => {
        const row = document.createElement('div');
        row.className = cls ? `row ${cls}` : 'row';
        const name = document.createElement('span');
        name.textContent = label;
        const val = document.createElement('strong');
        val.textContent = value;
        row.append(name, val);
        return row;
      }),
    );
  }

  function fillLevelScreen() {
    const L = LEVELS[game.levelIndex];
    const next = LEVELS[game.levelIndex + 1];
    const clear = game.lastClear;
    ui.levelTitle.textContent = `Level ${game.levelIndex + 1} cleared`;
    statRows(ui.levelStats, [
      ['Cores delivered', `${game.collected} / ${L.target}`],
      ['Time bonus', `+${clear.timeBonus}`],
      ['Flawless bonus', clear.flawless ? `+${clear.flawless}` : 'Missed (you were hit)'],
      ['Lives left', String(game.lives)],
      ['Score', String(game.score), 'total'],
    ]);
    ui.levelNext.textContent = `Next: ${next.name}. ${next.target} cores in ${next.time} seconds. ${next.tip}`;
    ui.nextBtn.textContent = `Start level ${game.levelIndex + 2}`;
  }

  function fillEndScreen(reason, isBest) {
    const L = LEVELS[game.levelIndex];
    const n = game.levelIndex + 1;
    ui.endScreen.dataset.result = reason === 'win' ? 'win' : 'over';
    if (reason === 'win') {
      ui.endTitle.textContent = 'Mission complete!';
      ui.endReason.textContent = `You delivered every core across all ${LEVELS.length} levels.`;
    } else if (reason === 'time') {
      ui.endTitle.textContent = 'Out of time';
      ui.endReason.textContent = `The clock ran out on level ${n} with ${game.collected} of ${L.target} cores delivered.`;
    } else {
      ui.endTitle.textContent = 'Ship destroyed';
      ui.endReason.textContent = `You lost your last life on level ${n}, ${L.name}.`;
    }
    ui.endScore.textContent = String(game.score);
    ui.endNew.hidden = !isBest;
    const cleared = reason === 'win' ? LEVELS.length : game.levelIndex;
    statRows(ui.endStats, [
      ['Levels cleared', `${cleared} / ${LEVELS.length}`],
      ['Cores delivered', String(game.totalCores)],
      ['Best score', String(game.best), 'total'],
    ]);
  }

  // ---- Flow -----------------------------------------------------------------
  function startGame() {
    audio.unlock();
    game.score = 0;
    game.lives = START_LIVES;
    game.totalCores = 0;
    startLevel(0);
  }

  function startLevel(index) {
    const L = LEVELS[index];
    game.levelIndex = index;
    game.collected = 0;
    game.timeLeft = L.time;
    game.lastTick = Math.ceil(L.time);
    game.combo = 0;
    game.comboTimer = 0;
    game.hits = 0;
    game.powerTimer = L.powerEvery * 0.7;
    game.readyTimer = READY_TIME;
    game.goTimer = 0;
    player = makePlayer();
    cores = [];
    asteroids = [];
    seekers = [];
    powerups = [];
    particles = [];
    texts = [];
    for (let i = 0; i < L.asteroids; i++) asteroids.push(makeAsteroid(L, findSpot(44, 220)));
    for (let i = 0; i < L.seekers; i++) seekers.push(makeSeeker(L, edgeSpot()));
    for (let i = 0; i < Math.min(L.field, L.target); i++) spawnCore();
    setState('ready');
    showBanner(`Level ${index + 1}: ${L.name}`, `Collect ${L.target} cores in ${L.time} seconds`, L.tip);
    audio.startMusic(index);
  }

  function nextLevel() {
    if (game.state === 'levelclear') startLevel(game.levelIndex + 1);
  }

  function levelComplete() {
    const timeBonus = Math.ceil(game.timeLeft) * TIME_BONUS;
    const flawless = game.hits === 0 ? FLAWLESS_BONUS : 0;
    game.score += timeBonus + flawless;
    game.lastClear = { timeBonus, flawless };
    emit(player.x, player.y, '#7dffb2', 30, 260, 0.9, 3);
    ring(player.x, player.y, '#7dffb2', 90);
    hideBanner();
    audio.stopMusic();
    if (game.levelIndex === LEVELS.length - 1) {
      endGame('win');
      return;
    }
    audio.play('levelClear');
    fillLevelScreen();
    setState('levelclear');
  }

  function endGame(reason) {
    const isBest = game.score > game.best;
    if (isBest) {
      game.best = game.score;
      save(BEST_KEY, game.best);
    }
    hideBanner();
    audio.stopMusic();
    audio.play(reason === 'win' ? 'win' : 'gameOver');
    fillEndScreen(reason, isBest);
    setState(reason === 'win' ? 'win' : 'over');
  }

  function pause() {
    if (game.state !== 'playing' && game.state !== 'ready') return;
    game.pausedFrom = game.state;
    keys.clear();
    pointer.active = false;
    audio.pauseMusic();
    setState('paused');
  }

  function resume() {
    if (game.state !== 'paused') return;
    setState(game.pausedFrom);
    audio.resumeMusic();
  }

  function toMenu() {
    audio.stopMusic();
    hideBanner();
    initAttract();
    ui.startBest.textContent = String(game.best);
    setState('menu');
  }

  // The menu shows a few rocks drifting behind the title.
  function initAttract() {
    player = null;
    cores = [];
    seekers = [];
    powerups = [];
    particles = [];
    texts = [];
    asteroids = [];
    for (let i = 0; i < 6; i++) asteroids.push(makeAsteroid(LEVELS[1], findSpot(44, 0)));
  }

  // ---- Entities -------------------------------------------------------------
  function makePlayer() {
    return {
      x: view.w / 2,
      y: (view.top + view.h) / 2,
      vx: 0,
      vy: 0,
      r: SHIP.r,
      angle: -Math.PI / 2,
      invuln: 0,
      dashTime: 0,
      dashCd: 0,
      shield: false,
      thrust: 0,
      trail: [],
      dead: false,
    };
  }

  function makeAsteroid(L, pos) {
    const r = rand(18, 40);
    const speed = rand(L.asteroidSpeed[0], L.asteroidSpeed[1]);
    const dir = rand(0, TAU);
    const points = 9 + Math.floor(r / 8);
    const light = rand(30, 38);
    // Lit from the top-left; the gradient is built once and reused because the rock is drawn unrotated around its centre.
    const fill = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    fill.addColorStop(0, `hsl(222, 20%, ${light + 14}%)`);
    fill.addColorStop(1, `hsl(226, 26%, ${light - 12}%)`);
    return {
      x: pos.x,
      y: pos.y,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      r,
      rot: rand(0, TAU),
      spin: rand(-0.8, 0.8),
      shape: Array.from({ length: points }, () => rand(0.74, 1)),
      craters: Array.from({ length: 2 + Math.floor(r / 16) }, () => ({ a: rand(0, TAU), d: rand(0.15, 0.55), r: rand(0.12, 0.22) })),
      fill,
    };
  }

  function makeSeeker(L, pos) {
    return { x: pos.x, y: pos.y, vx: 0, vy: 0, r: 13, speed: L.seekerSpeed, stun: 0.8, phase: rand(0, TAU) };
  }

  // A random point that keeps clear of the ship and the rocks. If none is found, the candidate furthest from the ship wins.
  function findSpot(margin, minFromPlayer, minFromCores = 0) {
    let fallback = null;
    let fallbackDist = -1;
    for (let i = 0; i < 40; i++) {
      const x = rand(margin, view.w - margin);
      const y = rand(view.top + margin, view.h - margin);
      const dp = player ? dist(x, y, player.x, player.y) : Infinity;
      if (dp > fallbackDist) {
        fallback = { x, y };
        fallbackDist = dp;
      }
      if (dp < minFromPlayer) continue;
      if (asteroids.some((a) => dist(x, y, a.x, a.y) < a.r + margin)) continue;
      if (minFromCores && cores.some((c) => dist(x, y, c.x, c.y) < minFromCores)) continue;
      return { x, y };
    }
    return fallback;
  }

  function edgeSpot() {
    let best = null;
    let bestDist = -1;
    for (let i = 0; i < 12; i++) {
      const side = Math.floor(rand(0, 4));
      const x = side === 0 ? 30 : side === 1 ? view.w - 30 : rand(30, view.w - 30);
      const y = side === 2 ? view.top + 30 : side === 3 ? view.h - 30 : rand(view.top + 30, view.h - 30);
      const d = player ? dist(x, y, player.x, player.y) : Infinity;
      if (d > bestDist) {
        best = { x, y };
        bestDist = d;
      }
      if (d > 300) break;
    }
    return best;
  }

  function spawnCore() {
    const spot = findSpot(26, 130, 90);
    cores.push({ x: spot.x, y: spot.y, r: 11, t: rand(0, TAU), age: 0 });
  }

  function spawnPowerup(L, forcedType) {
    let type = forcedType;
    if (!type) {
      const options = [
        ['shield', player && player.shield ? 1 : 3],
        ['time', game.timeLeft < L.time * 0.6 ? 3 : 1],
      ];
      if (game.lives < MAX_LIVES) options.push(['life', 0.8]);
      let roll = Math.random() * options.reduce((sum, o) => sum + o[1], 0);
      type = options[0][0];
      for (const [name, weight] of options) {
        roll -= weight;
        if (roll <= 0) {
          type = name;
          break;
        }
      }
    }
    const spot = findSpot(30, 150, 60);
    powerups.push({ type, x: spot.x, y: spot.y, r: 13, life: 9, age: 0 });
  }

  // ---- Effects --------------------------------------------------------------
  function emit(x, y, color, count, speed, life, size) {
    for (let i = 0; i < count && particles.length < 600; i++) {
      const a = rand(0, TAU);
      const v = speed * rand(0.25, 1);
      const l = life * rand(0.5, 1);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, size: size * rand(0.6, 1), color });
    }
  }

  function ring(x, y, color, radius) {
    particles.push({ ring: true, x, y, radius, life: 0.45, max: 0.45, color });
  }

  function floatText(x, y, text, color) {
    texts.push({ x: clamp(x, 60, view.w - 60), y, text, color, life: 0.9 });
  }

  function addShake(amount) {
    if (!reducedMotion) game.shake = Math.max(game.shake, amount);
  }

  // ---- Update ---------------------------------------------------------------
  function update(dt) {
    game.clock += dt;
    game.shake = Math.max(0, game.shake - dt * 40);
    updateStars(dt);
    updateParticles(dt);
    switch (game.state) {
      case 'menu':
      case 'over':
      case 'win':
        updateAsteroids(dt);
        break;
      case 'ready':
        animatePickups(dt);
        game.readyTimer -= dt;
        if (game.readyTimer <= 0) {
          setState('playing');
          showBanner('Go!');
          game.goTimer = 0.7;
        }
        break;
      case 'playing':
        updatePlaying(dt);
        break;
      case 'dying':
        updateAsteroids(dt);
        updateSeekers(dt);
        game.dyingTimer -= dt;
        if (game.dyingTimer <= 0) endGame('lives');
        break;
      default:
        break; // paused and levelclear freeze the field
    }
  }

  function updatePlaying(dt) {
    if (game.goTimer > 0) {
      game.goTimer -= dt;
      if (game.goTimer <= 0) hideBanner();
    }
    game.timeLeft -= dt;
    const secs = Math.ceil(game.timeLeft);
    if (secs < game.lastTick) {
      game.lastTick = secs;
      if (secs <= 10 && secs > 0) audio.play('tick', secs);
    }
    if (game.timeLeft <= 0) {
      game.timeLeft = 0;
      endGame('time');
      return;
    }
    if (game.comboTimer > 0) {
      game.comboTimer -= dt;
      if (game.comboTimer <= 0) game.combo = 0;
    }
    readInput();
    updatePlayer(dt);
    updateAsteroids(dt);
    updateSeekers(dt);
    animatePickups(dt);
    updatePowerups(dt);
    checkCollisions();
  }

  function updatePlayer(dt) {
    const p = player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    const moving = input.x !== 0 || input.y !== 0;
    if (p.dashTime > 0) {
      p.dashTime -= dt;
      const last = p.trail[p.trail.length - 1];
      if (!last || dist(last.x, last.y, p.x, p.y) > 12) p.trail.push({ x: p.x, y: p.y, a: p.angle, t: game.clock });
    } else {
      // Thrust plus drag gives a little drift but a firm top speed; letting go brakes harder.
      p.vx += input.x * SHIP.accel * dt;
      p.vy += input.y * SHIP.accel * dt;
      const drag = (SHIP.accel / SHIP.maxSpeed) * (moving ? 1 : 1.6);
      const f = Math.exp(-drag * dt);
      p.vx *= f;
      p.vy *= f;
    }
    while (p.trail.length && game.clock - p.trail[0].t > 0.16) p.trail.shift();

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < p.r) { p.x = p.r; p.vx = Math.max(0, p.vx); }
    if (p.x > view.w - p.r) { p.x = view.w - p.r; p.vx = Math.min(0, p.vx); }
    if (p.y < view.top + p.r) { p.y = view.top + p.r; p.vy = Math.max(0, p.vy); }
    if (p.y > view.h - p.r) { p.y = view.h - p.r; p.vy = Math.min(0, p.vy); }

    if (Math.hypot(p.vx, p.vy) > 25) p.angle = turnToward(p.angle, Math.atan2(p.vy, p.vx), 1 - Math.exp(-14 * dt));
    p.thrust = p.dashTime > 0 ? 2 : moving ? 1 : 0;
    if (p.thrust && Math.random() < dt * 45) {
      const back = p.angle + Math.PI + rand(-0.3, 0.3);
      const v = rand(60, 140);
      const l = rand(0.15, 0.3);
      particles.push({
        x: p.x + Math.cos(p.angle + Math.PI) * 10,
        y: p.y + Math.sin(p.angle + Math.PI) * 10,
        vx: Math.cos(back) * v + p.vx * 0.3,
        vy: Math.sin(back) * v + p.vy * 0.3,
        life: l,
        max: l,
        size: rand(2, 3.5),
        color: Math.random() < 0.5 ? '#ffb347' : '#ff7b39',
        drag: 3,
      });
    }
  }

  function requestDash() {
    if (game.state !== 'playing' || !player || player.dead || player.dashCd > 0) return;
    readInput();
    let dx = input.x;
    let dy = input.y;
    if (!dx && !dy) {
      dx = Math.cos(player.angle);
      dy = Math.sin(player.angle);
    }
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    player.vx = dx * SHIP.dashSpeed;
    player.vy = dy * SHIP.dashSpeed;
    player.angle = Math.atan2(dy, dx);
    player.dashTime = SHIP.dashTime;
    player.dashCd = SHIP.dashCooldown;
    emit(player.x, player.y, '#5ee0ff', 10, 120, 0.35, 2.5);
    audio.play('dash');
  }

  function bounceWalls(e) {
    if (e.x < e.r) { e.x = e.r; e.vx = Math.abs(e.vx); }
    else if (e.x > view.w - e.r) { e.x = view.w - e.r; e.vx = -Math.abs(e.vx); }
    if (e.y < view.top + e.r) { e.y = view.top + e.r; e.vy = Math.abs(e.vy); }
    else if (e.y > view.h - e.r) { e.y = view.h - e.r; e.vy = -Math.abs(e.vy); }
  }

  // Elastic collision between two rocks, with mass proportional to area.
  function collideRocks(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const min = (a.r + b.r) * 0.9;
    if (d === 0 || d >= min) return;
    const nx = dx / d;
    const ny = dy / d;
    const ma = a.r * a.r;
    const mb = b.r * b.r;
    const overlap = min - d;
    a.x -= nx * overlap * (mb / (ma + mb));
    a.y -= ny * overlap * (mb / (ma + mb));
    b.x += nx * overlap * (ma / (ma + mb));
    b.y += ny * overlap * (ma / (ma + mb));
    const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (approach >= 0) return;
    const j = (-2 * approach) / (1 / ma + 1 / mb);
    a.vx -= (j / ma) * nx;
    a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx;
    b.vy += (j / mb) * ny;
  }

  function updateAsteroids(dt) {
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.spin * dt;
      bounceWalls(a);
    }
    for (let i = 0; i < asteroids.length; i++) {
      for (let j = i + 1; j < asteroids.length; j++) collideRocks(asteroids[i], asteroids[j]);
    }
  }

  // Drones steer toward the ship with a lag (so they overshoot sharp turns) and slide around rocks instead of passing through.
  function updateSeekers(dt) {
    const target = player && !player.dead ? player : null;
    const steer = 1 - Math.exp(-1.8 * dt);
    for (const s of seekers) {
      s.phase += dt * 5;
      if (s.stun > 0) {
        s.stun -= dt;
        const f = Math.exp(-1.5 * dt);
        s.vx *= f;
        s.vy *= f;
      } else if (target) {
        const dx = target.x - s.x;
        const dy = target.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        s.vx += ((dx / d) * s.speed - s.vx) * steer;
        s.vy += ((dy / d) * s.speed - s.vy) * steer;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      for (const a of asteroids) {
        const dx = s.x - a.x;
        const dy = s.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = s.r + a.r * 0.9;
        if (d > 0 && d < min) {
          const nx = dx / d;
          const ny = dy / d;
          s.x = a.x + nx * min;
          s.y = a.y + ny * min;
          const vn = s.vx * nx + s.vy * ny;
          if (vn < 0) {
            s.vx -= vn * nx;
            s.vy -= vn * ny;
          }
        }
      }
      bounceWalls(s);
    }
    for (let i = 0; i < seekers.length; i++) {
      for (let j = i + 1; j < seekers.length; j++) {
        const a = seekers[i];
        const b = seekers[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r + 8;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }

  function animatePickups(dt) {
    for (const c of cores) {
      c.t += dt;
      c.age += dt;
    }
  }

  function updatePowerups(dt) {
    const L = LEVELS[game.levelIndex];
    game.powerTimer -= dt;
    if (game.powerTimer <= 0) {
      game.powerTimer = L.powerEvery;
      if (powerups.length === 0) spawnPowerup(L);
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      const u = powerups[i];
      u.age += dt;
      u.life -= dt;
      if (u.life <= 0) powerups.splice(i, 1);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      if (q.ring) continue;
      const f = Math.exp(-(q.drag || 2.2) * dt);
      q.vx *= f;
      q.vy *= f;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }

  function updateStars(dt) {
    for (const s of stars) {
      s.x -= 3 * s.depth * dt;
      s.y += 6 * s.depth * dt;
      s.tw += s.tws * dt;
    }
  }

  // ---- Collisions -----------------------------------------------------------
  function checkCollisions() {
    const p = player;
    for (let i = cores.length - 1; i >= 0; i--) {
      const c = cores[i];
      if (dist(p.x, p.y, c.x, c.y) < p.r + c.r + 4) {
        collectCore(i);
        if (game.state !== 'playing') return;
      }
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      const u = powerups[i];
      if (dist(p.x, p.y, u.x, u.y) < p.r + u.r + 4) {
        powerups.splice(i, 1);
        applyPowerup(u);
      }
    }
    if (p.invuln > 0 || p.dashTime > 0) return;
    // Hitboxes are a little smaller than the drawings, so near misses feel fair.
    const hitR = p.r * 0.7;
    for (const a of asteroids) {
      if (dist(p.x, p.y, a.x, a.y) < hitR + a.r * 0.86) {
        hitPlayer(a);
        return;
      }
    }
    for (const s of seekers) {
      if (s.stun <= 0 && dist(p.x, p.y, s.x, s.y) < hitR + s.r * 0.85) {
        const d = dist(p.x, p.y, s.x, s.y) || 1;
        s.stun = 1.4;
        s.vx = ((s.x - p.x) / d) * 260;
        s.vy = ((s.y - p.y) / d) * 260;
        hitPlayer(s);
        return;
      }
    }
  }

  function collectCore(i) {
    const L = LEVELS[game.levelIndex];
    const c = cores.splice(i, 1)[0];
    game.collected += 1;
    game.totalCores += 1;
    game.combo = game.comboTimer > 0 ? Math.min(game.combo + 1, COMBO_MAX) : 1;
    game.comboTimer = COMBO_WINDOW;
    const points = CORE_POINTS * game.combo;
    game.score += points;
    emit(c.x, c.y, '#ffd166', 16, 180, 0.6, 3);
    ring(c.x, c.y, '#ffd166', 34);
    floatText(c.x, c.y - 18, `+${points}`, '#ffd166');
    if (game.combo > 1) showCombo(game.combo);
    audio.play('pickup', game.combo);
    if (game.collected >= L.target) {
      levelComplete();
      return;
    }
    if (game.collected + cores.length < L.target) spawnCore();
  }

  function applyPowerup(u) {
    const color = POWER[u.type].color;
    emit(u.x, u.y, color, 18, 200, 0.6, 3);
    ring(u.x, u.y, color, 44);
    audio.play('power');
    if (u.type === 'shield') {
      if (player.shield) {
        game.score += 25;
        floatText(u.x, u.y - 18, '+25', color);
      } else {
        player.shield = true;
        floatText(u.x, u.y - 18, 'Shield up', color);
      }
    } else if (u.type === 'time') {
      game.timeLeft += TIME_PICKUP;
      game.lastTick = Math.ceil(game.timeLeft);
      floatText(u.x, u.y - 18, `+${TIME_PICKUP}s`, color);
    } else if (u.type === 'life') {
      game.lives = Math.min(MAX_LIVES, game.lives + 1);
      floatText(u.x, u.y - 18, '+1 life', color);
    }
  }

  function hitPlayer(src) {
    const p = player;
    const d = dist(p.x, p.y, src.x, src.y) || 1;
    p.vx = ((p.x - src.x) / d) * SHIP.knockback;
    p.vy = ((p.y - src.y) / d) * SHIP.knockback;
    if (p.shield) {
      p.shield = false;
      p.invuln = 1;
      emit(p.x, p.y, '#5ee0ff', 22, 220, 0.6, 3);
      ring(p.x, p.y, '#5ee0ff', 60);
      floatText(p.x, p.y - 28, 'Shield absorbed it', '#5ee0ff');
      addShake(6);
      audio.play('shield');
      return;
    }
    game.lives -= 1;
    game.hits += 1;
    game.combo = 0;
    game.comboTimer = 0;
    p.invuln = SHIP.invuln;
    emit(p.x, p.y, '#ff6b81', 26, 240, 0.7, 3.2);
    addShake(12);
    if (game.lives > 0) {
      floatText(p.x, p.y - 28, '-1 life', '#ff6b81');
      audio.play('hit');
      return;
    }
    game.lives = 0;
    p.dead = true;
    p.vx = 0;
    p.vy = 0;
    emit(p.x, p.y, '#ffd166', 40, 320, 1.1, 3.5);
    emit(p.x, p.y, '#eaf2ff', 24, 200, 0.9, 2.5);
    ring(p.x, p.y, '#ff9f43', 120);
    addShake(18);
    audio.stopMusic();
    audio.play('explode');
    game.dyingTimer = 1.4;
    setState('dying');
  }

  // ---- Rendering ------------------------------------------------------------
  function glowSprite(r, g, b) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g2 = c.getContext('2d');
    const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`);
    grad.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.45)`);
    grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.12)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, size, size);
    return c;
  }

  const sprites = {
    gold: glowSprite(255, 200, 90),
    cyan: glowSprite(94, 224, 255),
    red: glowSprite(255, 77, 109),
    green: glowSprite(125, 255, 178),
    pink: glowSprite(255, 126, 182),
  };

  function drawGlow(sprite, x, y, radius, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  function buildBackground() {
    background = document.createElement('canvas');
    background.width = canvas.width;
    background.height = canvas.height;
    const g = background.getContext('2d');
    const w = background.width;
    const h = background.height;
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#050816');
    base.addColorStop(1, '#0a1030');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    const nebulae = [
      [0.18, 0.3, 0.55, '88, 48, 170', 0.3],
      [0.84, 0.72, 0.6, '20, 110, 140', 0.26],
      [0.66, 0.14, 0.35, '190, 60, 120', 0.16],
      [0.32, 0.88, 0.42, '60, 80, 200', 0.18],
    ];
    for (const [bx, by, br, rgb, a] of nebulae) {
      const grad = g.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, br * m);
      grad.addColorStop(0, `rgba(${rgb}, ${a})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  }

  function buildStars() {
    const count = Math.round((view.w * view.h) / 3600);
    const depths = [0.25, 0.5, 1];
    stars = Array.from({ length: count }, (_, i) => {
      const depth = depths[i % 3];
      return {
        x: rand(0, view.w),
        y: rand(0, view.h),
        depth,
        size: depth === 1 ? rand(1.2, 2.2) : rand(0.6, 1.4),
        tw: rand(0, TAU),
        tws: rand(1, 3),
      };
    });
  }

  function drawStars() {
    // Stars shift slightly against the ship's position for a parallax feel.
    const px = player ? player.x - view.w / 2 : 0;
    const py = player ? player.y - view.h / 2 : 0;
    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      const x = mod(s.x - px * 0.04 * s.depth, view.w);
      const y = mod(s.y - py * 0.04 * s.depth, view.h);
      ctx.globalAlpha = (0.35 + 0.65 * s.depth) * (0.65 + 0.35 * Math.sin(s.tw));
      ctx.fillRect(x, y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawAsteroids() {
    ctx.lineJoin = 'round';
    for (const a of asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.beginPath();
      const n = a.shape.length;
      for (let i = 0; i < n; i++) {
        const ang = a.rot + (i / n) * TAU;
        const rr = a.r * a.shape[i];
        if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = a.fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(160, 176, 220, 0.75)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(8, 12, 28, 0.32)';
      for (const c of a.craters) {
        const ang = a.rot + c.a;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * c.d * a.r, Math.sin(ang) * c.d * a.r, c.r * a.r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function hexPath(r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      if (i === 0) ctx.moveTo(r, 0);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function drawCores() {
    if (!cores.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const c of cores) drawGlow(sprites.gold, c.x, c.y, 36 * grow(c.age) * (1 + 0.12 * Math.sin(c.t * 3)), 0.75);
    ctx.globalCompositeOperation = 'source-over';
    for (const c of cores) {
      const k = grow(c.age);
      if (k <= 0) continue;
      ctx.save();
      ctx.translate(c.x, c.y + Math.sin(c.t * 2) * 2);
      ctx.rotate(c.t * 0.9);
      ctx.scale(k, k);
      hexPath(c.r);
      ctx.fillStyle = '#ffc94d';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff3c4';
      ctx.stroke();
      hexPath(c.r * 0.45);
      ctx.fillStyle = '#fffbea';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPowerups() {
    for (const u of powerups) {
      if (u.life < 2 && Math.floor(u.life * 8) % 2 === 0) continue; // blink before expiring
      const style = POWER[u.type];
      const k = grow(u.age);
      const y = u.y + Math.sin(u.age * 3) * 2;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(sprites[style.sprite], u.x, y, 34 * k, 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(u.x, y);
      ctx.scale(k, k);
      ctx.beginPath();
      ctx.arc(0, 0, u.r, 0, TAU);
      ctx.fillStyle = 'rgba(8, 14, 34, 0.85)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = style.color;
      ctx.stroke();
      ctx.fillStyle = style.color;
      ctx.beginPath();
      if (u.type === 'shield') {
        ctx.moveTo(0, -7);
        ctx.lineTo(6, -4.5);
        ctx.lineTo(5, 2.5);
        ctx.lineTo(0, 7);
        ctx.lineTo(-5, 2.5);
        ctx.lineTo(-6, -4.5);
        ctx.closePath();
        ctx.fill();
      } else if (u.type === 'time') {
        ctx.lineWidth = 2;
        ctx.arc(0, 0, 6.5, 0, TAU);
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -4.5);
        ctx.moveTo(0, 0);
        ctx.lineTo(3.5, 1.5);
        ctx.stroke();
      } else {
        ctx.moveTo(0, 6);
        ctx.bezierCurveTo(-9, 0, -5, -8, 0, -3.5);
        ctx.bezierCurveTo(5, -8, 9, 0, 0, 6);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawSeekers() {
    if (!seekers.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of seekers) drawGlow(sprites.red, s.x, s.y, 36, s.stun > 0 ? 0.2 : 0.55 + 0.15 * Math.sin(s.phase));
    ctx.globalCompositeOperation = 'source-over';
    const target = player && !player.dead ? player : null;
    for (const s of seekers) {
      const stunned = s.stun > 0;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.phase * 0.5);
      ctx.fillStyle = stunned ? '#6b5560' : '#ff4d6d';
      for (let i = 0; i < 3; i++) {
        ctx.rotate(TAU / 3);
        ctx.beginPath();
        ctx.moveTo(s.r + 7, 0);
        ctx.lineTo(s.r - 2, -5);
        ctx.lineTo(s.r - 2, 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fillStyle = '#24101c';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = stunned ? '#8a7480' : '#ff4d6d';
      ctx.stroke();
      let ex = 0;
      let ey = 0;
      if (target) {
        const d = dist(s.x, s.y, target.x, target.y) || 1;
        ex = ((target.x - s.x) / d) * 4;
        ey = ((target.y - s.y) / d) * 4;
      }
      ctx.beginPath();
      ctx.arc(s.x + ex, s.y + ey, 4.5, 0, TAU);
      ctx.fillStyle = stunned ? '#a99aa2' : '#ffd0d8';
      ctx.fill();
    }
  }

  function drawShip(x, y, angle, alpha, ghost, thrust) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    if (thrust && !ghost) {
      const len = 9 + Math.random() * 8 + (thrust > 1 ? 12 : 0);
      ctx.beginPath();
      ctx.moveTo(-6, -5);
      ctx.lineTo(-6 - len, 0);
      ctx.lineTo(-6, 5);
      ctx.closePath();
      ctx.fillStyle = '#ff9f43';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6, -2.5);
      ctx.lineTo(-6 - len * 0.55, 0);
      ctx.lineTo(-6, 2.5);
      ctx.closePath();
      ctx.fillStyle = '#ffe9a8';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fillStyle = ghost ? '#5ee0ff' : '#eaf2ff';
    ctx.fill();
    if (!ghost) {
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#5ee0ff';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(3, 0, 4.5, 2.8, 0, 0, TAU);
      ctx.fillStyle = '#1a6fa0';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const p = player;
    if (!p || p.dead) return;
    for (const t of p.trail) drawShip(t.x, t.y, t.a, 0.35 * Math.max(0, 1 - (game.clock - t.t) / 0.16), true, 0);
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(sprites.cyan, p.x, p.y, 30, 0.35);
    if (p.shield) drawGlow(sprites.cyan, p.x, p.y, 48, 0.4);
    ctx.globalCompositeOperation = 'source-over';
    if (p.shield) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 23, 0, TAU);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(94, 224, 255, ${0.55 + 0.25 * Math.sin(game.clock * 6)})`;
      ctx.stroke();
    }
    const blink = p.invuln > 0 && p.dashTime <= 0 && Math.floor(p.invuln * 10) % 2 === 0;
    drawShip(p.x, p.y, p.angle, blink ? 0.25 : 1, false, game.state === 'playing' ? p.thrust : 0);
    if (p.dashCd > 0 && game.state === 'playing') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 27, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.dashCd / SHIP.dashCooldown));
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(94, 224, 255, 0.45)';
      ctx.stroke();
    }
  }

  function drawParticles() {
    if (!particles.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const q of particles) {
      const a = q.life / q.max;
      ctx.globalAlpha = a;
      if (q.ring) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.radius * (1 - a * a) + 2, 0, TAU);
        ctx.lineWidth = 2.5 * a + 0.5;
        ctx.strokeStyle = q.color;
        ctx.stroke();
      } else {
        const size = q.size * (0.4 + 0.6 * a);
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTexts() {
    if (!texts.length) return;
    ctx.font = '700 16px "Chakra Petch", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5, 8, 22, 0.8)';
    for (const t of texts) {
      ctx.globalAlpha = Math.min(1, t.life / 0.3);
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawJoystick() {
    if (!pointer.active || (game.state !== 'playing' && game.state !== 'ready')) return;
    const k = view.k;
    const ox = pointer.ox * k;
    const oy = pointer.oy * k;
    const dx = (pointer.x - pointer.ox) * k;
    const dy = (pointer.y - pointer.oy) * k;
    const R = JOY_RADIUS * k;
    const d = Math.hypot(dx, dy);
    const m = d > R ? R / d : 1;
    ctx.beginPath();
    ctx.arc(ox, oy, R, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ox + dx * m, oy + dy * m, R * 0.42, 0, TAU);
    ctx.fillStyle = 'rgba(94, 224, 255, 0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(94, 224, 255, 0.6)';
    ctx.stroke();
  }

  function render() {
    const s = view.dpr / view.k; // logical units -> device pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (background) ctx.drawImage(background, 0, 0);
    const ox = game.shake > 0 ? rand(-1, 1) * game.shake : 0;
    const oy = game.shake > 0 ? rand(-1, 1) * game.shake : 0;
    ctx.setTransform(s, 0, 0, s, ox * s, oy * s);
    drawStars();
    drawAsteroids();
    drawCores();
    drawPowerups();
    drawSeekers();
    drawPlayer();
    drawParticles();
    drawTexts();
    drawJoystick();
  }

  // ---- HUD ------------------------------------------------------------------
  const hudCache = {};

  function setHud(el, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.textContent = value;
  }

  function updateHud() {
    if (game.state === 'menu') return;
    const L = LEVELS[game.levelIndex];
    setHud(ui.score, 'score', String(game.score));
    setHud(ui.level, 'level', `${game.levelIndex + 1}/${LEVELS.length}`);
    setHud(ui.cores, 'cores', `${game.collected} / ${L.target}`);
    const pct = Math.min(100, (game.collected / L.target) * 100);
    if (hudCache.pct !== pct) {
      hudCache.pct = pct;
      ui.bar.style.width = `${pct}%`;
    }
    const secs = Math.max(0, Math.ceil(game.timeLeft));
    setHud(ui.time, 'time', String(secs));
    const warn = secs <= 10 && game.state === 'playing';
    if (hudCache.warn !== warn) {
      hudCache.warn = warn;
      ui.time.parentElement.classList.toggle('warn', warn);
    }
    setHud(ui.lives, 'lives', '♥'.repeat(game.lives) + '♡'.repeat(Math.max(0, START_LIVES - game.lives)));
    if (hudCache.livesLabel !== game.lives) {
      hudCache.livesLabel = game.lives;
      ui.lives.setAttribute('aria-label', `${game.lives} ${game.lives === 1 ? 'life' : 'lives'}`);
    }
  }

  // ---- Layout ---------------------------------------------------------------
  // The canvas fills the window. Game logic runs in "logical" units: about WORLD_AREA of them on every screen,
  // so a phone and a wide monitor get the same amount of room and the same difficulty.
  function resize() {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let k = Math.sqrt(WORLD_AREA / (cssW * cssH));
    k = Math.max(k, MIN_SIDE / Math.min(cssW, cssH));
    view.k = k;
    view.dpr = dpr;
    view.w = cssW * k;
    view.h = cssH * k;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    measureHud();
    buildBackground();
    buildStars();
    clampAll();
  }

  // The playfield starts below the HUD bar.
  function measureHud() {
    const bottom = ui.hud.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty('--hud-h', `${Math.round(bottom)}px`);
    view.top = bottom * view.k;
  }

  function clampAll() {
    const fit = (e) => {
      e.x = clamp(e.x, e.r, view.w - e.r);
      e.y = clamp(e.y, view.top + e.r, view.h - e.r);
    };
    if (player) fit(player);
    cores.forEach(fit);
    asteroids.forEach(fit);
    seekers.forEach(fit);
    powerups.forEach(fit);
  }

  // ---- Main loop ------------------------------------------------------------
  let lastTime = performance.now();

  function frame(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05); // after a stall, slow down rather than teleport
    // Small fixed-ish steps keep fast dashes from skipping over pickups.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) update(dt / steps);
    audio.tick();
    updateHud();
    render();
    requestAnimationFrame(frame);
  }

  function init() {
    const best = Number(load(BEST_KEY, 0));
    game.best = Number.isFinite(best) && best > 0 ? Math.floor(best) : 0;
    audio.setMuted(load(MUTE_KEY, false) === true);
    syncMute();
    if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
    window.addEventListener('resize', resize);
    resize();
    initAttract();
    ui.startBest.textContent = String(game.best);
    setState('menu');
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        measureHud();
        clampAll();
      });
    }
    requestAnimationFrame(frame);
  }

  // Test hooks, only with ?debug in the URL.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__sc = {
      game,
      view,
      levels: LEVELS,
      get player() { return player; },
      get cores() { return cores; },
      get asteroids() { return asteroids; },
      get seekers() { return seekers; },
      get powerups() { return powerups; },
      startGame,
      startLevel,
      spawnPowerup: (type) => spawnPowerup(LEVELS[game.levelIndex], type),
      // Runs the simulation for a fixed time regardless of frame rate, then draws one frame (unless draw is false).
      advance(seconds, draw = true) {
        for (let t = 0; t < seconds; t += 1 / 120) update(1 / 120);
        if (!draw) return;
        updateHud();
        render();
      },
    };
  }

  init();
})();
