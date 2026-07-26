import * as THREE from 'three';
import { Input } from './Input.js';
import { AssetForge } from './AssetForge.js';
import { Environment } from '../world/Environment.js';
import { Level } from '../world/Level.js';
import { Player } from '../player/Player.js';
import { ViewModel } from '../player/ViewModel.js';
import { Effects } from '../fx/Effects.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { HUD } from '../ui/HUD.js';
import { PostFX } from '../fx/PostFX.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { WEAPONS, WEAPON_ORDER, damageAtRange } from '../combat/Weapons.js';

/**
 * Game — top-level orchestrator. Owns the renderer, the two-scene (world +
 * viewmodel) render pipeline, the fixed-ish timestep loop, and all gameplay
 * glue: shooting, ammo/reload, scoring, waves, player damage, and states.
 */
export class Game {
  constructor(canvas, hudRoot, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.running = false;
    this.paused = false;

    this._initRenderer();
    this._initScenes();

    this.forge = new AssetForge();
    this.audio = new AudioEngine();
    this.input = new Input(canvas);

    this.env = new Environment(this.scene, this.renderer);
    this.level = new Level(this.scene, this.forge);
    this.player = new Player(this.camera, this.level, this.input);
    this.viewModel = new ViewModel(this.forge, this.audio);
    this.vmScene.add(this.viewModel.group);
    this.effects = new Effects(this.scene);
    this.enemies = new EnemyManager(this.scene, this.forge, this.level);
    this.enemies.setColliderMeshes(this.level.solidMeshes);
    this.hud = new HUD(hudRoot);

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    // world-space muzzle light so gunfire illuminates the environment
    this.muzzleLight = new THREE.PointLight(0xffca70, 0, 18, 2);
    this.scene.add(this.muzzleLight);
    this._muzzleWorld = new THREE.Vector3();

    this._raycaster = new THREE.Raycaster();
    this._clock = new THREE.Clock();

    // start with rifle (must precede HUD/state init which reads current weapon)
    this.viewModel.equip('rifle');
    this.viewModel.onReloadDone = () => this._finishReload();

    this._initGameState();
    this._wireCallbacks();
    this._bindResize();

    this._loop = this._loop.bind(this);
  }

  // ---------------------------------------------------------------- setup
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
  }

  _initScenes() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 6000);
    this.camera.layers.enable(0);
    this.baseFov = 78;

    // separate scene + camera for the first-person weapon (never clips world)
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.005, 20);
    this.vmScene.add(new THREE.AmbientLight(0xafc0d0, 1.4));
    const vmKey = new THREE.DirectionalLight(0xffffff, 2.4);
    vmKey.position.set(0.4, 0.8, 0.6);
    this.vmScene.add(vmKey);
    const vmRim = new THREE.DirectionalLight(0x88aaff, 1.0);
    vmRim.position.set(-0.6, 0.2, -0.5);
    this.vmScene.add(vmRim);
  }

  _initGameState() {
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.state = 'playing';
    this.fireTimer = 0;
    this.ammo = {};
    for (const id of WEAPON_ORDER) {
      this.ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserve };
    }
    this.spreadCurrent = 0;
    this.enemies.startNextWave();
    this._refreshHUD();
  }

  _wireCallbacks() {
    this.input.onLockChange = (locked) => {
      if (!locked && this.running && this.player.alive) {
        this.paused = true;
        this.callbacks.onPause?.();
      } else if (locked) {
        this.paused = false;
        this.callbacks.onResume?.();
      }
    };

    this.enemies.onPlayerDamage = (dmg, from) => {
      this.player.damage(dmg);
      this.postfx.triggerHurt(Math.min(1, dmg / 20));
      this.audio.playerHurt();
      this._refreshHUD();
      if (!this.player.alive) this._gameOver();
    };
    this.enemies.onWaveStart = (wave, count) => {
      this.hud.setWave(`WAVE ${wave}`);
      this.hud.announce(`WAVE ${wave}`, `${count} HOSTILES INBOUND`);
    };
    this.enemies.onWaveClear = (wave) => {
      this.hud.announce('SECTOR CLEAR', 'REINFORCEMENTS INCOMING');
      this.player.heal(25);
      this._refreshHUD();
    };
  }

  _bindResize() {
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.vmCamera.aspect = w / h;
      this.vmCamera.updateProjectionMatrix();
      this.postfx.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize);
  }

  // ---------------------------------------------------------------- control
  start() {
    this.audio.init();
    this.audio.resume();
    this.running = true;
    this.paused = false;
    this._clock.start();
    this.input.requestLock();
    requestAnimationFrame(this._loop);
  }

  resume() {
    this.audio.resume();
    this.paused = false;
    this.input.requestLock();
  }

  restart() {
    this.player.position.set(0, 0, 30);
    this.player.velocity.set(0, 0, 0);
    this.player.health = this.player.maxHealth;
    this.player.alive = true;
    this.enemies.reset();
    this._initGameState();
    this.state = 'playing';
  }

  // ---------------------------------------------------------------- combat
  _tryFire(dt) {
    const def = this.viewModel.def;
    const id = this.viewModel.currentId;
    const mag = this.ammo[id];
    this.fireTimer -= dt;

    const wantsFire = def.auto ? this.input.buttons.left : this.input.pressed('MouseNever');
    const semiFire = !def.auto && this.input.buttons.left && !this._leftHeld;
    this._leftHeld = this.input.buttons.left;

    const firing = def.auto ? this.input.buttons.left : semiFire;
    if (!firing) return;
    if (this.viewModel.reloading) return;
    if (this.fireTimer > 0) return;

    if (mag.mag <= 0) {
      if (semiFire || (def.auto && this._justEmptyClick !== true)) {
        this.audio.empty();
        this._justEmptyClick = true;
      }
      // auto-reload convenience
      this._startReload();
      return;
    }
    this._justEmptyClick = false;

    this.fireTimer = 60 / def.rpm;
    mag.mag--;
    this._shoot(def);
    this._refreshHUD();
  }

  _shoot(def) {
    this.audio.gunshot(this.viewModel.currentId);
    this.viewModel.fireFX();

    // recoil to camera
    this.player.addRecoil(def.recoilPitch, (Math.random() - 0.5) * def.recoilYaw * 2);
    this.spreadCurrent = Math.min(1, this.spreadCurrent + 0.16);

    // muzzle world position (offset in camera space)
    const camMat = this.camera.matrixWorld;
    this._muzzleWorld.set(0.16, -0.14, -0.6).applyMatrix4(camMat);
    this.muzzleLight.position.copy(this._muzzleWorld);
    this.muzzleLight.intensity = 8 * (def.muzzleFlashScale || 1);

    // eject casing
    const ejectPos = new THREE.Vector3(0.2, -0.05, -0.3).applyMatrix4(camMat);
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.effects.spawnCasing(ejectPos, camDir);

    // aim from screen center with spread
    const spread = (this.player.aiming ? def.adsSpread : def.spread) *
      (1 + this.spreadCurrent * 1.6) * (this.player.sprinting ? 2.2 : 1);

    for (let p = 0; p < (def.pellets || 1); p++) {
      const dir = camDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      this._traceShot(def, dir);
    }
  }

  _traceShot(def, dir) {
    const origin = this.camera.position.clone();
    this._raycaster.set(origin, dir);
    this._raycaster.far = def.range;
    this._raycaster.camera = this.camera;

    // enemies
    const enemyHit = this.enemies.raycast(this._raycaster);
    // world
    const worldHits = this._raycaster.intersectObjects(this.level.solidMeshes, false);
    const worldHit = worldHits.length ? worldHits[0] : null;

    const useEnemy = enemyHit && (!worldHit || enemyHit.dist < worldHit.distance);

    // tracer start near muzzle
    const tracerStart = this._muzzleWorld.clone();

    if (useEnemy) {
      const dist = enemyHit.dist;
      let dmg = damageAtRange(def, dist);
      const mult = enemyHit.part === 'head' ? def.headshotMult :
        enemyHit.part === 'limb' ? 0.85 : 1.0;
      dmg *= mult;
      const res = enemyHit.enemy.takeDamage(dmg, enemyHit.part);
      this.effects.spawnTracer(tracerStart, enemyHit.point);
      this.effects.spawnImpact(enemyHit.point, dir.clone().negate(), 'flesh');
      this.audio.impact('flesh');
      this.hud.hitmarker(res.killed);
      this.audio.hitmarker(res.killed);
      if (res.killed) this._onKill(enemyHit.part === 'head');
    } else if (worldHit) {
      const type = this._surfaceType(worldHit.object);
      this.effects.spawnTracer(tracerStart, worldHit.point);
      this.effects.spawnImpact(worldHit.point, worldHit.face ? worldHit.face.normal.clone().transformDirection(worldHit.object.matrixWorld) : dir.clone().negate(), type);
      this.effects.spawnDecal(worldHit.point, worldHit.face ? worldHit.face.normal.clone().transformDirection(worldHit.object.matrixWorld) : new THREE.Vector3(0, 1, 0));
      this.audio.impact(type);
    } else {
      const end = origin.clone().addScaledVector(dir, def.range);
      this.effects.spawnTracer(tracerStart, end);
    }
  }

  _surfaceType(obj) {
    const m = obj.material;
    if (!m) return 'default';
    if (m.metalness >= 0.8) return 'metal';
    return 'concrete';
  }

  _onKill(headshot) {
    this.kills++;
    this.combo++;
    this.comboTimer = 4;
    const base = headshot ? 150 : 100;
    const points = base + this.combo * 10;
    this.score += points;
    this.hud.setScore(this.score);
    const tag = headshot ? '<b>HEADSHOT</b>' : 'ELIMINATED';
    const comboTag = this.combo > 1 ? ` <b>x${this.combo}</b>` : '';
    this.hud.killfeed(`${tag}${comboTag} <span style="color:#8b9aa6">+${points}</span>`);
    if (headshot) this.hud.announce('HEADSHOT', `+${points}`, 1.1);
  }

  _startReload() {
    const id = this.viewModel.currentId;
    const mag = this.ammo[id];
    const def = this.viewModel.def;
    if (mag.mag >= def.magSize || mag.reserve <= 0 || this.viewModel.reloading) return;
    if (this.viewModel.startReload()) {
      this.hud.setReloading(true);
    }
  }

  _finishReload() {
    const id = this.viewModel.currentId;
    const mag = this.ammo[id];
    const def = this.viewModel.def;
    const need = def.magSize - mag.mag;
    const take = Math.min(need, mag.reserve);
    mag.mag += take;
    mag.reserve -= take;
    this.hud.setReloading(false);
    this._refreshHUD();
  }

  _refreshHUD() {
    const id = this.viewModel.currentId;
    const def = WEAPONS[id];
    const mag = this.ammo[id];
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setAmmo(mag.mag, mag.reserve, def.magSize);
    this.hud.setWeapon(def.name, def.auto ? 'AUTO' : 'SEMI');
  }

  _gameOver() {
    this.state = 'gameover';
    this.hud.announce('YOU DIED', `SCORE ${this.score} · WAVE ${this.enemies.wave}`, 999);
    this.callbacks.onGameOver?.(this.score, this.enemies.wave, this.kills);
    document.exitPointerLock?.();
  }

  // ---------------------------------------------------------------- input glue
  _handleWeaponSwitch() {
    if (this.input.pressed('Digit1')) this._equip('rifle');
    if (this.input.pressed('Digit2')) this._equip('smg');
    if (this.input.pressed('Digit3')) this._equip('pistol');
    if (this.input.wheel !== 0) {
      this.viewModel.nextWeapon(this.input.wheel > 0 ? 1 : -1);
      this._refreshHUD();
    }
    if (this.input.pressed('KeyR')) this._startReload();
  }

  _equip(id) {
    this.viewModel.equip(id);
    this._refreshHUD();
  }

  // ---------------------------------------------------------------- loop
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this._clock.getDelta());
    if (this.paused || this.state === 'gameover') {
      // still render a frame so pause overlay shows the frozen world
      this._render(dt);
      this.input.endFrame();
      return;
    }

    // aim
    this.player.aiming = this.input.buttons.right && !this.viewModel.reloading;

    const move = this.player.update(dt);
    this._handleWeaponSwitch();
    this._tryFire(dt);

    // ADS fov
    const def = this.viewModel.def;
    const targetFov = this.player.aiming ? def.adsFov : this.baseFov * (this.player.sprinting ? 1.06 : 1);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();

    // viewmodel
    this.viewModel.update(dt, {
      moveSpeed: move.speed, aiming: this.player.aiming, moving: move.moving,
      onGround: this.player.onGround, sprinting: this.player.sprinting,
      mouseDX: this.input.mouseDX, mouseDY: this.input.mouseDY,
    });

    // spread recovery
    this.spreadCurrent = Math.max(0, this.spreadCurrent - dt * 2.2);
    const baseSpreadPx = this.player.aiming ? 0 : 8;
    const moveSpread = (move.speed / this.player.speedWalk) * 6;
    this.hud.setSpread(baseSpreadPx + moveSpread + this.spreadCurrent * 22, this.player.aiming);

    // muzzle light decay
    this.muzzleLight.intensity *= Math.max(0, 1 - dt * 20);

    // combo timer
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }

    // enemies
    this.enemies.update(dt, this.player, this.effects, this.audio);
    this.hud.setObjective(`SECTOR — <b>${this.enemies.aliveCount ?? 0} HOSTILES</b>`);

    this.effects.update(dt);
    this.env.update(dt);
    this.hud.update(dt, this.player.yaw);

    // keep sky centered on player
    this.env.sky.position.copy(this.camera.position);

    this._render(dt);
    this.input.endFrame();
  }

  _render(dt) {
    // world (with post-processing) → screen
    this.postfx.render(dt);
    // viewmodel on top, no depth conflict with world
    this.renderer.clearDepth();
    this.vmCamera.quaternion.identity();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this._onResize);
  }
}
