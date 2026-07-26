import * as THREE from 'three';

/**
 * Enemy — a procedurally-modeled hostile soldier with a lightweight AI state
 * machine (idle → chase → attack → strafe/cover), animated limbs, a health
 * bar, hit reactions and a death tumble. Hitboxes: head + torso + limbs.
 */
const STATE = { IDLE: 0, CHASE: 1, ATTACK: 2, DEAD: 3 };

export class Enemy {
  constructor(scene, forge, spawnPos) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(spawnPos);
    this.group.position.y = 0;
    scene.add(this.group);

    this.health = 100;
    this.maxHealth = 100;
    this.state = STATE.IDLE;
    this.alive = true;
    this.speed = 3.4 + Math.random() * 1.4;
    this.fireCooldown = 0;
    this.fireRate = 0.6 + Math.random() * 0.6;
    this.accuracy = 0.55 + Math.random() * 0.2;
    this.damage = 8;
    this.velocity = new THREE.Vector3();
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.animPhase = Math.random() * Math.PI * 2;
    this.deathTime = 0;

    this._build(forge);
    this._collectHitboxes();
  }

  _build(forge) {
    const fatigue = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.09 + Math.random() * 0.06, 0.25, 0.22),
      roughness: 0.85, metalness: 0.02,
    });
    const gear = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7, metalness: 0.15 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.7 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x2a2d22, roughness: 0.6, metalness: 0.2 });

    // torso
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), fatigue);
    this.torso.position.y = 1.15;
    this.group.add(this.torso);
    // vest overlay
    const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.32), vest);
    vestMesh.position.y = 1.22; this.group.add(vestMesh);
    // pelvis
    this.pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.26), gear);
    this.pelvis.position.y = 0.78; this.group.add(this.pelvis);
    // head + helmet
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
    this.head.position.y = 1.68; this.group.add(this.head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), gear);
    helmet.position.y = 1.74; this.group.add(helmet);

    // arms
    const armGeo = new THREE.BoxGeometry(0.13, 0.55, 0.13);
    armGeo.translate(0, -0.27, 0);
    this.armL = new THREE.Mesh(armGeo, fatigue);
    this.armL.position.set(-0.33, 1.45, 0.05); this.group.add(this.armL);
    this.armR = new THREE.Mesh(armGeo, fatigue);
    this.armR.position.set(0.33, 1.45, 0.05); this.group.add(this.armR);

    // legs
    const legGeo = new THREE.BoxGeometry(0.16, 0.7, 0.18);
    legGeo.translate(0, -0.35, 0);
    this.legL = new THREE.Mesh(legGeo, gear);
    this.legL.position.set(-0.13, 0.75, 0); this.group.add(this.legL);
    this.legR = new THREE.Mesh(legGeo, gear);
    this.legR.position.set(0.13, 0.75, 0); this.group.add(this.legR);

    // rifle in hands
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.5, metalness: 0.4 }));
    rifle.position.set(0.2, 1.3, -0.25); this.group.add(rifle);
    this.rifle = rifle;

    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // health bar sprite
    const c = document.createElement('canvas');
    c.width = 64; c.height = 8;
    this._hpCanvas = c; this._hpCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    this._hpTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(1.0, 0.12, 1);
    spr.position.y = 2.05;
    this.group.add(spr);
    this.hpBar = spr;
    this._drawHP();
  }

  _drawHP() {
    const ctx = this._hpCtx;
    ctx.clearRect(0, 0, 64, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 64, 8);
    const t = this.health / this.maxHealth;
    ctx.fillStyle = t > 0.5 ? '#33e0c0' : t > 0.25 ? '#ffb020' : '#ff3b4e';
    ctx.fillRect(1, 1, 62 * Math.max(0, t), 6);
    this._hpTex.needsUpdate = true;
  }

  _collectHitboxes() {
    // logical hitboxes relative to group; recomputed each frame via world pos
    this.hitboxes = [
      { part: 'head', mesh: this.head, mult: 1 },
      { part: 'torso', mesh: this.torso, mult: 1 },
      { part: 'limb', mesh: this.legL, mult: 1 },
      { part: 'limb', mesh: this.legR, mult: 1 },
      { part: 'limb', mesh: this.armL, mult: 1 },
      { part: 'limb', mesh: this.armR, mult: 1 },
    ];
  }

  // Ray test against this enemy's boxes. Returns {dist, part} or null.
  raycast(raycaster) {
    if (!this.alive) return null;
    let best = null;
    for (const hb of this.hitboxes) {
      const hits = raycaster.intersectObject(hb.mesh, false);
      if (hits.length) {
        if (!best || hits[0].distance < best.dist) {
          best = { dist: hits[0].distance, part: hb.part, point: hits[0].point };
        }
      }
    }
    return best;
  }

  takeDamage(amount, part) {
    if (!this.alive) return { killed: false, headshot: false };
    const headshot = part === 'head';
    this.health -= amount;
    this._drawHP();
    // flinch
    this.torso.position.z = -0.04;
    if (this.health <= 0) { this.die(); return { killed: true, headshot }; }
    return { killed: false, headshot };
  }

  die() {
    this.alive = false;
    this.state = STATE.DEAD;
    this.deathTime = 0;
    this.hpBar.visible = false;
    this.deathSpin = (Math.random() - 0.5) * 3;
  }

  update(dt, playerPos, hasLineOfSight, level, onShoot) {
    if (this.state === STATE.DEAD) {
      this.deathTime += dt;
      // topple + sink
      const t = Math.min(1, this.deathTime / 0.7);
      this.group.rotation.x = -t * Math.PI * 0.5;
      this.group.rotation.z = this.deathSpin * t * 0.3;
      this.group.position.y = -t * 0.3;
      return this.deathTime > 6; // request removal after 6s
    }

    this.animPhase += dt * this.velocity.length() * 2.2;
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const dist = toPlayer.length();
    toPlayer.y = 0; toPlayer.normalize();

    // face player
    const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
    let dy = targetYaw - this.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.group.rotation.y += dy * Math.min(1, dt * 6);

    // state logic
    if (dist > 40 || !hasLineOfSight) this.state = STATE.CHASE;
    else if (dist < 22) this.state = STATE.ATTACK;
    else this.state = STATE.CHASE;

    const desired = new THREE.Vector3();
    if (this.state === STATE.CHASE) {
      desired.copy(toPlayer).multiplyScalar(this.speed);
    } else if (this.state === STATE.ATTACK) {
      // strafe + maintain distance
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1 + Math.random() * 1.5; }
      const right = new THREE.Vector3(toPlayer.z, 0, -toPlayer.x);
      desired.addScaledVector(right, this.strafeDir * this.speed * 0.7);
      if (dist < 14) desired.addScaledVector(toPlayer, -this.speed * 0.4);
      // fire
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0 && hasLineOfSight) {
        this.fireCooldown = this.fireRate;
        if (onShoot) onShoot(this, this.accuracy);
        this.rifle.position.z = -0.35; // kick
      }
    }

    // integrate w/ simple collision via level
    this.velocity.lerp(desired, Math.min(1, dt * 6));
    const next = this.group.position.clone().addScaledVector(this.velocity, dt);
    next.y = this.group.position.y;
    if (level) {
      const head = next.clone(); head.y += 1.7;
      const res = level.collide(head, 0.45, 1.7);
      next.x = res.x; next.z = res.z;
    }
    this.group.position.x = next.x;
    this.group.position.z = next.z;

    // limb animation (walk cycle)
    const swing = Math.sin(this.animPhase) * Math.min(1, this.velocity.length() / this.speed);
    this.legL.rotation.x = swing * 0.8;
    this.legR.rotation.x = -swing * 0.8;
    this.armL.rotation.x = -swing * 0.4 - 0.3;
    this.armR.rotation.x = -0.5; // holding rifle

    // recover flinch/kick
    this.torso.position.z += (0 - this.torso.position.z) * Math.min(1, dt * 10);
    this.rifle.position.z += (-0.25 - this.rifle.position.z) * Math.min(1, dt * 12);

    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose?.(); }
    });
    this._hpTex.dispose();
  }
}
