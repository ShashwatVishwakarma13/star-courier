# Star Courier

A browser arcade game built with plain HTML, CSS and JavaScript (no frameworks, no build step, no image or audio files). It was built with an AI coding assistant (Claude Code) for the IIT Patna capstone project "Build & Host a Video Game".

## Game concept

| | |
|---|---|
| **Game name** | Star Courier |
| **Target player** | Casual players and students aged 10 and up who want a quick game in the browser on a laptop or phone. |
| **Objective** | You pilot a small courier ship. On each level, collect the required number of glowing energy cores before the timer runs out. |
| **Controls** | Arrow keys or WASD to fly, **Space** to dash, **P**/**Esc** to pause, **M** to mute. On phones, drag anywhere to steer and tap the **Dash** button. |
| **Scoring** | 10 points per core. Grab cores within 2.5 s of each other for a combo multiplier, up to ×5. Each level clear adds a time bonus of 5 points per second left, plus 100 points if you weren't hit. |
| **Challenges** | Drifting asteroids that bounce off each other and the walls, red drones that chase you (from level 3), and the countdown timer. |
| **Help** | The dash gives a short burst of speed and passes through hazards, with a 1.4 s cooldown. Power-ups appear now and then: Shield (blocks one hit), +8 seconds, and Extra life. |
| **How you win** | Clear all 5 levels. |
| **How you lose** | Lose all 3 lives, or let the timer reach zero. |
| **Restart** | **Play again** on the game-over screen (or press **R**), or **Restart** from the pause menu. |

### Levels

Every number below lives in [`js/levels.js`](js/levels.js), so the balance can be changed without touching the game code.

| # | Name | Cores | Time | Asteroids (speed) | Drones |
|---|---|---|---|---|---|
| 1 | Training Run | 8 | 45 s | 4 (slow) | 0 |
| 2 | Debris Belt | 10 | 40 s | 7 (medium) | 0 |
| 3 | Drone Patrol | 12 | 45 s | 5 (medium) | 2 |
| 4 | Storm Front | 14 | 50 s | 8 (fast) | 2 |
| 5 | Core Meltdown | 16 | 55 s | 9 (fastest) | 3 (faster) |

From level 4, only 2 cores are on the field at a time instead of 3, and the music speeds up with each level.

### Other features

- Start, pause, level-cleared, game-over and victory screens.
- Best score saved in the browser (`localStorage`).
- Sound effects and background music generated in code with the Web Audio API, with a mute toggle that is remembered.
- Works on phones: touch joystick, Dash button, and a HUD that wraps onto two rows on small screens.
- The playfield scales to keep about the same amount of room on every screen size, so difficulty doesn't depend on the device.
- Pauses automatically when the tab is hidden or the window loses focus.

## Run it locally

Open `index.html` in a browser by double-clicking it. Or serve the folder, which is closer to how it runs once hosted:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploy (public URL)

The folder is a static site, so any static host works. Upload it as is.

- **Vercel**: push the folder to a GitHub repository, then "Add New → Project", import it, set Framework Preset to **Other**, and deploy. No build command is needed.
- **Netlify**: drag the folder onto https://app.netlify.com/drop.
- **GitHub Pages**: push to a repository, then Settings → Pages → Deploy from branch → `main` / root.

## Project structure

```
index.html       page layout: canvas, HUD and the overlay screens
css/style.css    all styling, including the phone layout
js/levels.js     level data (difficulty tuning)
js/audio.js      synthesised sound effects and music
js/game.js       game loop, entities, collisions, input, rendering, screens
assets/icon.svg  favicon
```

## Testing hook

Adding `?debug` to the URL exposes `window.__sc`, which can start levels, spawn power-ups and run the simulation for a fixed time (`__sc.advance(seconds)`) from the browser console. It was used to test pickups, combos, hits, the shield, power-ups, dash, level transitions, time-outs, game over, the full 5-level win and the touch controls. Without `?debug`, nothing is exposed.
