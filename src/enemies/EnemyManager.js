import * as THREE from 'three';
import { Enemy } from './Enemy.js';

/**
 * EnemyManager — spawns escalating waves, ticks each enemy's AI, performs
 * line-of-sight checks against level geometry, and routes enemy fire back to
 * the player. Exposes raycasting so the player's shots can resolve hits.
 */
export class EnemyManager {
  constructor(scene, forge, level) {
    this.scene = scene;
    this.forge = forge;
    this.level = level;
    this.enemies = [];
    this.wave = 0;
    this.enemiesRemaining = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.betweenWaves = 3;
    this.state = 'intermission'; // intermission | active
    this._losRay = new THREE.Raycaster();
    this.onPlayerDamage = null;
    this.onWaveStart = null;
    this.colliderMeshes = null;
  }

  setColliderMeshes(meshes) { this.colliderMeshes = meshes; }

  startNextWave() {
    this.wave++;
    const count = Math.min(4 + this.wave * 2, 18);
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) this.spawnQueue.push(i);
    this.enemiesRemaining = count;
    this.state = 'active';
    this.spawnTimer = 0;
    if (this.onWaveStart) this.onWaveStart(this.wave, count);
  }

  _spawnOne() {
    const pts = this.level.spawnPoints;
    const p = pts[Math.floor(Math.random() * pts.length)].clone();
    p.x += (Math.random() - 0.5) * 8;
    p.z += (Math.random() - 0.5) * 8;
    const e = new Enemy(this.scene, this.forge, p);
    // scale stats with wave
    e.health = e.maxHealth = 100 + this.wave * 8;
    e.damage = 7 + this.wave * 0.6;
    e.accuracy = Math.min(0.85, 0.5 + this.wave * 0.03);
    this.enemies.push(e);
  }

  hasLineOfSight(from, to) {
    if (!this.colliderMeshes || this.colliderMeshes.length === 0) return true;
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    this._losRay.set(from, dir);
    this._losRay.far = dist;
    const hits = this._losRay.intersectObjects(this.colliderMeshes, false);
    return hits.length === 0;
  }

  // Player shot: returns { hit, enemy, part, point, killed, headshot } or {hit:false}
  raycast(raycaster) {
    let best = null;
    for (const e of this.enemies) {
      const r = e.raycast(raycaster);
      if (r && (!best || r.dist < best.dist)) best = { ...r, enemy: e };
    }
    return best;
  }

  update(dt, player, effects, audio) {
    const playerPos = player.position.clone();
    playerPos.y += player.currentHeight;

    // spawning
    if (this.state === 'active' && this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnOne();
        this.spawnQueue.shift();
        this.spawnTimer = 0.6 + Math.random() * 0.7;
      }
    }

    // tick enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const eyePos = e.group.position.clone(); eyePos.y += 1.6;
      const los = e.alive ? this.hasLineOfSight(eyePos, playerPos) : false;
      const remove = e.update(dt, playerPos, los, this.level, (enemy, accuracy) => {
        // enemy fires at player
        this._enemyShoot(enemy, player, accuracy, effects, audio);
      });
      if (remove) { e.dispose(); this.enemies.splice(i, 1); }
    }

    // wave completion
    const aliveCount = this.enemies.filter((e) => e.alive).length;
    if (this.state === 'active' && this.spawnQueue.length === 0 && aliveCount === 0) {
      this.state = 'intermission';
      this.spawnTimer = this.betweenWaves;
      if (this.onWaveClear) this.onWaveClear(this.wave);
    } else if (this.state === 'intermission') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) this.startNextWave();
    }

    this.aliveCount = aliveCount;
  }

  _enemyShoot(enemy, player, accuracy, effects, audio) {
    const from = enemy.group.position.clone(); from.y += 1.4;
    const target = player.position.clone(); target.y += player.currentHeight * 0.8;
    const dist = from.distanceTo(target);
    // accuracy: chance to hit inversely with distance
    const hitChance = accuracy * THREE.MathUtils.clamp(1 - dist / 60, 0.15, 1);
    const to = target.clone();
    const hit = Math.random() < hitChance;
    if (!hit) {
      // miss: spread the tracer
      to.x += (Math.random() - 0.5) * 3;
      to.y += (Math.random() - 0.5) * 3;
      to.z += (Math.random() - 0.5) * 3;
    }
    effects.spawnTracer(from, to);
    if (audio) audio.gunshot('rifle');
    if (hit && this.onPlayerDamage) this.onPlayerDamage(enemy.damage, from);
  }

  reset() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    this.wave = 0;
    this.state = 'intermission';
    this.spawnTimer = 1.5;
  }
}
