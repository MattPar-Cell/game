import * as THREE from 'three';

/**
 * Effects — pooled particle systems for muzzle-adjacent combat feedback:
 * bullet tracers, surface impact sparks/dust, blood mist, bullet-hole decals,
 * shell casings, and explosions. All pooled to avoid GC hitching.
 */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this._initTracers();
    this._initSparks();
    this._initDecals();
    this._initCasings();
    this._initSmoke();
  }

  // ------------------------------------------------------------- tracers
  _initTracers() {
    this.tracers = [];
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2); // along -z after scaling
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffdd88, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._tracerGeo = geo;
    this._tracerMat = mat;
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      this.scene.add(m);
      this.tracers.push({ mesh: m, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  spawnTracer(from, to) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    t.life = 0.08;
    t.from.copy(from); t.to.copy(to);
    const m = t.mesh;
    m.visible = true;
    m.position.copy(from);
    const dist = from.distanceTo(to);
    m.scale.set(1, 1, dist);
    m.lookAt(to);
    m.material.opacity = 0.9;
  }

  // ------------------------------------------------------------- sparks/dust
  _initSparks() {
    this.sparkPool = [];
    const COUNT = 30;
    for (let p = 0; p < COUNT; p++) {
      const n = 12;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: 0.06, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffbb55,
      });
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      this.scene.add(pts);
      this.sparkPool.push({ pts, vel: [], life: 0, n });
    }
  }

  spawnImpact(point, normal, type = 'default') {
    const s = this.sparkPool.find((x) => x.life <= 0) || this.sparkPool[0];
    s.life = type === 'flesh' ? 0.35 : 0.4;
    s.pts.visible = true;
    const colors = { default: 0xffcc66, metal: 0xfff0c0, flesh: 0xaa1122, concrete: 0xbbb0a0 };
    s.pts.material.color.setHex(colors[type] ?? colors.default);
    s.pts.material.size = type === 'flesh' ? 0.05 : 0.045;
    const pos = s.pts.geometry.attributes.position.array;
    s.vel = [];
    const basis = new THREE.Vector3().copy(normal);
    for (let i = 0; i < s.n; i++) {
      pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
      const v = basis.clone().multiplyScalar(1.5 + Math.random() * 2.5);
      v.x += (Math.random() - 0.5) * 3;
      v.y += (Math.random() - 0.5) * 3 + 1;
      v.z += (Math.random() - 0.5) * 3;
      s.vel.push(v);
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = 1;
  }

  // ------------------------------------------------------------- decals
  _initDecals() {
    this.decals = [];
    this.decalIndex = 0;
    this.maxDecals = 64;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(10,8,6,0.95)');
    g.addColorStop(0.5, 'rgba(20,16,12,0.7)');
    g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    // cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 7;
      ctx.beginPath(); ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    this._decalTex = tex;
    this._decalGeo = new THREE.PlaneGeometry(0.35, 0.35);
  }

  spawnDecal(point, normal) {
    let d = this.decals[this.decalIndex];
    if (!d) {
      const mat = new THREE.MeshBasicMaterial({
        map: this._decalTex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.9,
      });
      const mesh = new THREE.Mesh(this._decalGeo, mat);
      this.scene.add(mesh);
      d = { mesh };
      this.decals[this.decalIndex] = d;
    }
    d.mesh.position.copy(point).addScaledVector(normal, 0.02);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    d.mesh.quaternion.copy(q);
    d.mesh.rotateZ(Math.random() * Math.PI);
    const s = 0.7 + Math.random() * 0.6;
    d.mesh.scale.set(s, s, s);
    d.mesh.material.opacity = 0.9;
    d.mesh.visible = true;
    this.decalIndex = (this.decalIndex + 1) % this.maxDecals;
  }

  // ------------------------------------------------------------- casings
  _initCasings() {
    this.casings = [];
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4a838, metalness: 1, roughness: 0.35 });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), life: 0 });
    }
    this.casingIdx = 0;
  }

  spawnCasing(pos, dir) {
    const c = this.casings[this.casingIdx];
    this.casingIdx = (this.casingIdx + 1) % this.casings.length;
    c.life = 2.5;
    c.mesh.visible = true;
    c.mesh.position.copy(pos);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    c.vel.copy(right).multiplyScalar(2 + Math.random());
    c.vel.y += 2 + Math.random();
    c.vel.addScaledVector(dir, -0.5);
    c.angVel.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }

  // ------------------------------------------------------------- smoke/explosion
  _initSmoke() {
    this.explosions = [];
  }

  spawnExplosion(point) {
    const light = new THREE.PointLight(0xff8833, 30, 25, 2);
    light.position.copy(point);
    this.scene.add(light);
    const geo = new THREE.SphereGeometry(0.6, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, blending: THREE.AdditiveBlending });
    const ball = new THREE.Mesh(geo, mat);
    ball.position.copy(point);
    this.scene.add(ball);
    this.explosions.push({ light, ball, life: 0.6, max: 0.6 });
    this.spawnImpact(point, new THREE.Vector3(0, 1, 0), 'metal');
  }

  update(dt) {
    // tracers
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    // sparks
    for (const s of this.sparkPool) {
      if (s.life > 0) {
        s.life -= dt;
        const pos = s.pts.geometry.attributes.position.array;
        for (let i = 0; i < s.n; i++) {
          s.vel[i].y -= 9 * dt;
          pos[i * 3] += s.vel[i].x * dt;
          pos[i * 3 + 1] += s.vel[i].y * dt;
          pos[i * 3 + 2] += s.vel[i].z * dt;
        }
        s.pts.geometry.attributes.position.needsUpdate = true;
        s.pts.material.opacity = Math.max(0, s.life / 0.4);
        if (s.life <= 0) s.pts.visible = false;
      }
    }
    // casings
    for (const c of this.casings) {
      if (c.life > 0) {
        c.life -= dt;
        c.vel.y -= 12 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        if (c.mesh.position.y < 0.03) { c.mesh.position.y = 0.03; c.vel.y *= -0.3; c.vel.multiplyScalar(0.6); }
        c.mesh.rotation.x += c.angVel.x * dt;
        c.mesh.rotation.y += c.angVel.y * dt;
        if (c.life <= 0) c.mesh.visible = false;
      }
    }
    // explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= dt;
      const t = 1 - e.life / e.max;
      e.ball.scale.setScalar(1 + t * 6);
      e.ball.material.opacity = Math.max(0, 1 - t);
      e.light.intensity = Math.max(0, 30 * (1 - t));
      if (e.life <= 0) {
        this.scene.remove(e.ball, e.light);
        e.ball.geometry.dispose(); e.ball.material.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }
}
