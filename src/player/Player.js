import * as THREE from 'three';

/**
 * Player — first-person camera controller with acceleration-based movement,
 * sprint, crouch, jump/gravity, head-bob, view-punch (recoil), and lean.
 *
 * The camera is driven here; the weapon viewmodel is parented to the camera
 * externally so sway/bob compose naturally.
 */
const PI2 = Math.PI / 2;

export class Player {
  constructor(camera, level, input) {
    this.camera = camera;
    this.level = level;
    this.input = input;

    this.position = new THREE.Vector3(0, 0, 30);   // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;

    this.eyeHeight = 1.7;
    this.crouchHeight = 1.05;
    this.currentHeight = this.eyeHeight;
    this.radius = 0.4;

    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.aiming = false;

    this.speedWalk = 5.2;
    this.speedSprint = 8.6;
    this.speedCrouch = 2.6;
    this.accel = 60;
    this.airAccel = 12;
    this.friction = 10;
    this.jumpForce = 6.4;
    this.gravity = 20;

    // procedural motion state
    this.bobT = 0;
    this.bobAmount = new THREE.Vector2();
    this.viewPunch = new THREE.Vector2();  // pitch, yaw kick
    this.viewPunchVel = new THREE.Vector2();
    this.recoilRecover = 12;
    this.lean = 0;

    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.lastDamageTime = -10;

    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
  }

  addRecoil(pitchKick, yawKick) {
    this.viewPunchVel.x += pitchKick;
    this.viewPunchVel.y += yawKick;
  }

  damage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastDamageTime = performance.now() / 1000;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }

  update(dt) {
    const input = this.input;

    // ---- look
    this.yaw -= input.mouseDX * input.sensitivity;
    this.pitch -= input.mouseDY * input.sensitivity;
    this.pitch = Math.max(-PI2 + 0.05, Math.min(PI2 - 0.05, this.pitch));

    // ---- desired movement
    const forward = this._tmpForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = this._tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let wish = new THREE.Vector3();
    if (input.isDown('KeyW')) wish.add(forward);
    if (input.isDown('KeyS')) wish.sub(forward);
    if (input.isDown('KeyD')) wish.add(right);
    if (input.isDown('KeyA')) wish.sub(right);
    const moving = wish.lengthSq() > 0.001;
    if (moving) wish.normalize();

    this.crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
    this.sprinting = input.isDown('ShiftLeft') && moving && !this.crouching &&
      input.isDown('KeyW') && !this.aiming;

    let targetSpeed = this.speedWalk;
    if (this.crouching) targetSpeed = this.speedCrouch;
    else if (this.sprinting) targetSpeed = this.speedSprint;
    if (this.aiming) targetSpeed *= 0.55;

    // ---- horizontal acceleration + friction (source-style feel)
    const accel = this.onGround ? this.accel : this.airAccel;
    const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    if (this.onGround && !moving) {
      const drop = horizVel.length() * this.friction * dt;
      const nl = Math.max(0, horizVel.length() - drop);
      if (horizVel.length() > 0.0001) horizVel.setLength(nl);
    }
    if (moving) {
      const wishVel = wish.clone().multiplyScalar(targetSpeed);
      horizVel.x += (wishVel.x - horizVel.x) * Math.min(1, accel * dt / targetSpeed);
      horizVel.z += (wishVel.z - horizVel.z) * Math.min(1, accel * dt / targetSpeed);
      if (horizVel.length() > targetSpeed && this.onGround) horizVel.setLength(targetSpeed);
    }
    this.velocity.x = horizVel.x;
    this.velocity.z = horizVel.z;

    // ---- jump / gravity
    if (input.isDown('Space') && this.onGround) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }
    this.velocity.y -= this.gravity * dt;

    // ---- integrate + collide
    const next = this.position.clone().addScaledVector(this.velocity, dt);

    // horizontal collision (resolve at head-height capsule)
    const headPos = next.clone(); headPos.y += this.currentHeight;
    const resolved = this.level.collide(headPos, this.radius, this.currentHeight);
    next.x = resolved.x; next.z = resolved.z;

    // vertical: ground / step-up on colliders
    const gh = this.level.groundHeight(next.x, next.z, this.position.y + 0.3);
    if (next.y <= gh) {
      next.y = gh;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = Math.abs(next.y - gh) < 0.02;
    }
    this.position.copy(next);

    // ---- crouch height smoothing
    const targetH = this.crouching ? this.crouchHeight : this.eyeHeight;
    this.currentHeight += (targetH - this.currentHeight) * Math.min(1, dt * 12);

    // ---- lean (Q/E)
    let targetLean = 0;
    if (input.isDown('KeyQ')) targetLean = 0.28;
    if (input.isDown('KeyE')) targetLean = -0.28;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 10);

    // ---- head bob
    const speed = horizVel.length();
    if (this.onGround && speed > 0.5) {
      const freq = this.sprinting ? 13 : 9;
      this.bobT += dt * freq;
      const amp = (this.sprinting ? 0.09 : 0.05) * (this.aiming ? 0.3 : 1);
      this.bobAmount.set(Math.cos(this.bobT) * amp * 0.6, Math.abs(Math.sin(this.bobT)) * amp);
    } else {
      this.bobT = 0;
      this.bobAmount.lerp(new THREE.Vector2(0, 0), Math.min(1, dt * 8));
    }

    // ---- view punch spring recovery
    this.viewPunch.x += this.viewPunchVel.x * dt;
    this.viewPunch.y += this.viewPunchVel.y * dt;
    this.viewPunchVel.multiplyScalar(Math.max(0, 1 - dt * 18));
    this.viewPunch.multiplyScalar(Math.max(0, 1 - dt * this.recoilRecover));

    // ---- compose camera transform
    const cam = this.camera;
    cam.position.set(
      this.position.x + this.bobAmount.x * 0.3,
      this.position.y + this.currentHeight + this.bobAmount.y,
      this.position.z,
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.viewPunch.y;
    cam.rotation.x = this.pitch + this.viewPunch.x + this.bobAmount.y * 0.02;
    cam.rotation.z = this.lean * 0.6 + this.bobAmount.x * 0.04;

    return { speed, moving };
  }
}
