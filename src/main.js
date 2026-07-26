import { Game } from './core/Game.js';

/**
 * Entry point — manages the start/loading overlay, boots the Game once the
 * user clicks DEPLOY (required for pointer-lock + audio to unlock), and wires
 * the pause / game-over UI.
 */
const canvas = document.getElementById('game-canvas');
const hudRoot = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const loaderFill = document.getElementById('loader-fill');
const loaderText = document.getElementById('loader-text');
const loader = document.getElementById('loader');
const pauseEl = document.getElementById('pause');

let game = null;

// Fake-but-real loading: constructing the Game synchronously forges every
// texture/material, so we build it across a few frames and animate progress.
const steps = [
  'FORGING PBR MATERIALS…',
  'GENERATING TERRAIN & STRUCTURES…',
  'CALIBRATING BALLISTICS…',
  'INITIALIZING POST-PROCESS STACK…',
  'SYNTHESIZING AUDIO…',
  'DEPLOYING…',
];

async function boot() {
  let p = 0;
  const tick = (target, label) => new Promise((res) => {
    loaderText.textContent = label;
    const iv = setInterval(() => {
      p += (target - p) * 0.3 + 0.5;
      if (p >= target - 0.5) { p = target; clearInterval(iv); res(); }
      loaderFill.style.width = p + '%';
    }, 16);
  });

  await tick(15, steps[0]);
  // build the game (heavy: forges all assets)
  await new Promise((r) => setTimeout(r, 30));
  game = new Game(canvas, hudRoot, {
    onPause: () => pauseEl.classList.remove('hidden'),
    onResume: () => pauseEl.classList.add('hidden'),
    onGameOver: (score, wave, kills) => showGameOver(score, wave, kills),
  });
  await tick(45, steps[1]);
  await tick(62, steps[2]);
  await tick(78, steps[3]);
  await tick(90, steps[4]);
  await tick(100, steps[5]);

  // Debug hook for automated capture / QA harness.
  window.__GAME__ = game;

  loader.style.display = 'none';
  startBtn.disabled = false;
  loaderText.textContent = '';
}

startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  game.start();
});

// resume from pause by clicking the frozen screen
document.addEventListener('click', () => {
  if (game && game.running && game.paused && game.state !== 'gameover') {
    game.resume();
  }
});

function showGameOver(score, wave, kills) {
  pauseEl.classList.remove('hidden');
  pauseEl.querySelector('.pause-inner').innerHTML = `
    <div class="pause-title" style="color:#ff3b4e">K.I.A.</div>
    <div class="pause-hint" style="font-size:18px;margin-top:16px">
      SCORE <b style="color:#33e0c0">${score}</b> &nbsp;·&nbsp; WAVE <b style="color:#ffb020">${wave}</b> &nbsp;·&nbsp; ${kills} KILLS
    </div>
    <button id="respawn-btn" class="start-btn" style="display:inline-block;margin-top:32px">
      <span class="start-btn-label" style="font-size:20px">REDEPLOY</span>
    </button>
  `;
  pauseEl.querySelector('#respawn-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    pauseEl.classList.add('hidden');
    game.restart();
    game.resume();
  });
}

boot().catch((e) => {
  console.error('BOOT FAILURE:', e && e.stack ? e.stack : e);
});
