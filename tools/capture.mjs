/**
 * capture.mjs — headless QA harness. Boots the built game in Chromium with
 * software WebGL, drives the camera to a set of cinematic vantage points, and
 * writes screenshots to tools/shots/. Used to visually judge render quality.
 *
 * Usage: node tools/capture.mjs [outdir]
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const URL = process.env.GAME_URL || 'http://localhost:4173/';
const W = 1600, H = 900;

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const views = [
  { name: '01-spawn',    pos: [0, 0, 30],   yaw: Math.PI,        pitch: -0.05 },
  { name: '02-courtyard',pos: [0, 0, 8],    yaw: Math.PI * 0.75, pitch: -0.02 },
  { name: '03-tower',    pos: [18, 0, 18],  yaw: -2.35,          pitch: 0.15 },
  { name: '04-containers',pos: [-14, 0, -6],yaw: -1.2,           pitch: 0.0 },
  { name: '05-sun',      pos: [-30, 0, 20], yaw: 0.9,            pitch: 0.25 },
  { name: '06-building', pos: [40, 0, -20], yaw: 2.6,            pitch: 0.05 },
  { name: '07-ads',      pos: [0, 0, 20],   yaw: Math.PI,        pitch: 0.0, ads: true },
  { name: '08-firefight',pos: [5, 0, 25],   yaw: Math.PI,        pitch: 0.0, fire: true },
  { name: '09-weapon',   pos: [-14, 0, -4], yaw: -1.4,           pitch: -0.08 },
  { name: '10-vista',    pos: [-60, 0, -60],yaw: -2.3,           pitch: 0.08 },
];

async function run() {
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--enable-webgl', '--disable-dev-shm-usage',
      `--window-size=${W},${H}`,
    ],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

  // wait for DEPLOY button to enable (all assets forged)
  await page.waitForFunction(() => {
    const b = document.getElementById('start-btn');
    return b && !b.disabled;
  }, { timeout: 60000 });

  await page.click('#start-btn');
  await page.waitForFunction(() => !!window.__GAME__ && window.__GAME__.running, { timeout: 15000 });
  // let a few frames render + IBL settle
  await page.waitForTimeout(1200);

  for (const v of views) {
    await page.evaluate((view) => {
      const g = window.__GAME__;
      if (!g) return;
      g.paused = false;
      g.player.position.set(view.pos[0], view.pos[1], view.pos[2]);
      g.player.yaw = view.yaw;
      g.player.pitch = view.pitch;
      g.player.aiming = !!view.ads;
      if (view.ads) g.input.buttons.right = true; else g.input.buttons.right = false;
    }, v);
    // hold a beat so ADS fov / motion settle
    await page.waitForTimeout(v.ads ? 600 : 350);
    if (v.fire) {
      // hold fire, then snap several frames to reliably catch a muzzle flash
      await page.evaluate(() => { window.__GAME__.input.buttons.left = true; });
      let bestShot = null;
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(30);
        const flashOn = await page.evaluate(() => window.__GAME__.viewModel.flashTime > 0.02);
        if (flashOn) { bestShot = true; break; }
      }
      await page.screenshot({ path: path.join(OUT, v.name + '.png') });
      await page.evaluate(() => { window.__GAME__.input.buttons.left = false; });
      process.stdout.write(`captured ${v.name}${bestShot ? ' (flash)' : ''}\n`);
      continue;
    }
    await page.screenshot({ path: path.join(OUT, v.name + '.png') });
    process.stdout.write(`captured ${v.name}\n`);
  }

  // report render stats
  const stats = await page.evaluate(() => {
    const g = window.__GAME__;
    return {
      enemies: g.enemies.enemies.length,
      draws: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
      textures: g.renderer.info.memory.textures,
      programs: g.renderer.info.programs?.length,
    };
  });

  await browser.close();
  console.log('\nRender stats:', JSON.stringify(stats, null, 2));
  if (errors.length) {
    console.log('\n⚠️  Console errors:');
    for (const e of errors.slice(0, 20)) console.log('  ', e);
  } else {
    console.log('\n✓ No console errors.');
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
