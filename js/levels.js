/* Level definitions. Every number that controls difficulty lives here, so balancing never touches game.js. */
window.SC_LEVELS = [
  {
    name: 'Training Run',
    tip: 'Press Space to dash straight through danger.',
    target: 8, time: 45, field: 3,
    asteroids: 4, asteroidSpeed: [35, 65],
    seekers: 0, seekerSpeed: 0,
    powerEvery: 12,
  },
  {
    name: 'Debris Belt',
    tip: 'More rocks, and they move faster.',
    target: 10, time: 40, field: 3,
    asteroids: 7, asteroidSpeed: [50, 90],
    seekers: 0, seekerSpeed: 0,
    powerEvery: 12,
  },
  {
    name: 'Drone Patrol',
    tip: 'Red drones hunt you. Lure them into rocks.',
    target: 12, time: 45, field: 3,
    asteroids: 5, asteroidSpeed: [55, 95],
    seekers: 2, seekerSpeed: 105,
    powerEvery: 11,
  },
  {
    name: 'Storm Front',
    tip: 'Faster rocks, and fewer cores on the field at once.',
    target: 14, time: 50, field: 2,
    asteroids: 8, asteroidSpeed: [70, 115],
    seekers: 2, seekerSpeed: 125,
    powerEvery: 10,
  },
  {
    name: 'Core Meltdown',
    tip: 'Final run. Everything is faster.',
    target: 16, time: 55, field: 2,
    asteroids: 9, asteroidSpeed: [80, 135],
    seekers: 3, seekerSpeed: 140,
    powerEvery: 10,
  },
];
