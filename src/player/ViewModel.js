import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER } from '../combat/Weapons.js';

/**
 * ViewModel — builds procedural first-person weapon meshes and drives all
 * first-person weapon motion: idle sway, movement bob, ADS transition,
 * recoil kick, reload dip, and the muzzle-flash light + sprite.
 *
 * The viewmodel lives on its own layer rendered with a separate near camera
 * so the gun never clips into world geometry.
 */
export class ViewModel {
  constructor(forge, audio) {
    this.forge = forge;
    this.audio = audio;
    this.group = new THREE.Group();          // parented to viewmodel camera
    this.group.name = 'viewmodel';

    this.weapons = {};
    this.current = null;
    this.currentId = null;

    // animation state
    this.swayPos = new THREE.Vector3();
    this.swayRot = new THREE.Vector3();
    this.recoilOffset = new THREE.Vector3();
    this.recoilRot = new THREE.Vector3();
    this.adsBlend = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.equipTimer = 0;
    this.bobPhase = 0;

    this._buildAll();
    this._buildMuzzle();
  }

  _gunMetal(tint, rough = 0.35) {
    // brighter tints + env reflections read as real gunmetal
    const t = tint.map((c) => Math.min(1, c * 1.5 + 0.06));
    return this.forge.metal({ repeat: 2, tint: t, seed: 2100 + Math.floor(rough * 100), rough });
  }

  _polymer(color = 0x2e333c) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, envMapIntensity: 1.0 });
  }

  _buildAll() {
    this.weapons.rifle = this._buildRifle();
    this.weapons.smg = this._buildSMG();
    this.weapons.pistol = this._buildPistol();
    for (const id in this.weapons) {
      this.weapons[id].visible = false;
      this.weapons[id].scale.setScalar(0.82);
      this.group.add(this.weapons[id]);
    }
  }

  _part(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = false;
    parent.add(m);
    return m;
  }

  _applyLayer() { /* viewmodel lives in its own scene; no layer masking needed */ }

  _buildRifle() {
    const g = new THREE.Group();
    const body = this._polymer(0x2c313a);
    const metal = this._gunMetal([0.22, 0.23, 0.25], 0.3);
    const dark = this._gunMetal([0.1, 0.1, 0.11], 0.5);

    // receiver
    this._part(g, new THREE.BoxGeometry(0.09, 0.11, 0.5), body, 0, 0, 0);
    // upper rail
    this._part(g, new THREE.BoxGeometry(0.07, 0.03, 0.46), dark, 0, 0.07, 0.02);
    // barrel
    this._part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.42, 16), metal, 0, 0.01, -0.42, Math.PI / 2, 0, 0);
    // handguard
    this._part(g, new THREE.BoxGeometry(0.07, 0.07, 0.34), dark, 0, 0.01, -0.28);
    // muzzle brake
    this._part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12), dark, 0, 0.01, -0.64, Math.PI / 2, 0, 0);
    // magazine (curved)
    const mag = this._part(g, new THREE.BoxGeometry(0.06, 0.22, 0.1), body, 0, -0.16, 0.05, 0.25);
    mag.name = 'magazine';
    // pistol grip
    this._part(g, new THREE.BoxGeometry(0.06, 0.16, 0.07), body, 0, -0.11, 0.22, -0.35);
    // stock
    this._part(g, new THREE.BoxGeometry(0.05, 0.09, 0.26), body, 0, 0.0, 0.4);
    this._part(g, new THREE.BoxGeometry(0.04, 0.13, 0.05), body, 0, -0.02, 0.28);
    // optic
    this._part(g, new THREE.BoxGeometry(0.05, 0.06, 0.14), dark, 0, 0.11, 0.04);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 20),
      new THREE.MeshStandardMaterial({ color: 0x0a1a14, roughness: 0.15, metalness: 0.3 }));
    lens.position.set(0, 0.11, 0.111);
    g.add(lens);
    // reticle dot
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 12),
      new THREE.MeshBasicMaterial({ color: 0x44ff99 }));
    dot.position.set(0, 0.11, 0.113);
    g.add(dot);
    // charging handle
    this._part(g, new THREE.BoxGeometry(0.02, 0.02, 0.06), metal, 0.05, 0.05, 0.12);

    this._applyLayer(g);
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.68);
    g.userData.rest = { pos: new THREE.Vector3(0.17, -0.2, -0.52), rot: new THREE.Vector3(0.02, 0.05, 0) };
    g.userData.ads = { pos: new THREE.Vector3(0, -0.092, -0.42), rot: new THREE.Vector3(0, 0, 0) };
    return g;
  }

  _buildSMG() {
    const g = new THREE.Group();
    const body = this._polymer(0x30353e);
    const metal = this._gunMetal([0.2, 0.21, 0.23], 0.32);
    const dark = this._gunMetal([0.09, 0.09, 0.1], 0.5);

    this._part(g, new THREE.BoxGeometry(0.08, 0.1, 0.34), body, 0, 0, 0);
    this._part(g, new THREE.CylinderGeometry(0.015, 0.015, 0.26, 14), metal, 0, 0.01, -0.28, Math.PI / 2, 0, 0);
    this._part(g, new THREE.BoxGeometry(0.06, 0.05, 0.2), dark, 0, 0.02, -0.18);
    this._part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.06, 12), dark, 0, 0.01, -0.42, Math.PI / 2, 0, 0);
    const mag = this._part(g, new THREE.BoxGeometry(0.05, 0.24, 0.06), body, 0, -0.17, 0.02);
    mag.name = 'magazine';
    this._part(g, new THREE.BoxGeometry(0.055, 0.14, 0.06), body, 0, -0.1, 0.14, -0.3);
    // folding stock
    this._part(g, new THREE.BoxGeometry(0.04, 0.02, 0.2), dark, 0, 0.04, 0.24);
    this._part(g, new THREE.BoxGeometry(0.04, 0.08, 0.03), dark, 0, 0.0, 0.34);
    // sight
    this._part(g, new THREE.BoxGeometry(0.04, 0.05, 0.1), dark, 0, 0.09, 0.0);

    this._applyLayer(g);
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.46);
    g.userData.rest = { pos: new THREE.Vector3(0.17, -0.19, -0.48), rot: new THREE.Vector3(0.02, 0.06, 0) };
    g.userData.ads = { pos: new THREE.Vector3(0, -0.1, -0.4), rot: new THREE.Vector3(0, 0, 0) };
    return g;
  }

  _buildPistol() {
    const g = new THREE.Group();
    const body = this._polymer(0x2d323b);
    const metal = this._gunMetal([0.18, 0.19, 0.21], 0.28);
    const dark = this._gunMetal([0.08, 0.08, 0.09], 0.45);

    this._part(g, new THREE.BoxGeometry(0.05, 0.07, 0.22), metal, 0, 0.02, 0);
    this._part(g, new THREE.BoxGeometry(0.045, 0.05, 0.24), dark, 0, 0.02, -0.01);
    this._part(g, new THREE.CylinderGeometry(0.01, 0.01, 0.05, 12), dark, 0, 0.03, -0.13, Math.PI / 2, 0, 0);
    // grip
    const mag = this._part(g, new THREE.BoxGeometry(0.05, 0.13, 0.055), body, 0, -0.07, 0.06, -0.2);
    mag.name = 'magazine';
    // sights
    this._part(g, new THREE.BoxGeometry(0.01, 0.015, 0.015), dark, 0, 0.06, -0.09);
    this._part(g, new THREE.BoxGeometry(0.02, 0.015, 0.015), dark, 0, 0.06, 0.09);

    this._applyLayer(g);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.16);
    g.userData.rest = { pos: new THREE.Vector3(0.15, -0.2, -0.44), rot: new THREE.Vector3(0.03, 0.04, 0) };
    g.userData.ads = { pos: new THREE.Vector3(0, -0.115, -0.4), rot: new THREE.Vector3(0, 0, 0) };
    return g;
  }

  _buildMuzzle() {
    // flash sprite
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.25, 'rgba(255,220,120,0.9)');
    grd.addColorStop(0.6, 'rgba(255,140,40,0.35)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(64, 64, 64, 0, 7); ctx.fill();
    // star spikes
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,235,180,0.8)'; ctx.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(64, 64);
      ctx.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    this.flash = new THREE.Sprite(mat);
    this.flash.scale.set(0.5, 0.5, 1);
    this.group.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffca70, 0, 12, 2);
    this.group.add(this.flashLight);

    this.flashTime = 0;
  }

  equip(id) {
    if (this.currentId === id) return;
    if (this.current) this.current.visible = false;
    this.currentId = id;
    this.current = this.weapons[id];
    this.current.visible = true;
    this.def = WEAPONS[id];
    this.equipTimer = 0.4;
    this.reloading = false;
    this.reloadTimer = 0;
    if (this.audio) this.audio.play('equip');
  }

  nextWeapon(dir) {
    const idx = WEAPON_ORDER.indexOf(this.currentId);
    const n = (idx + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    this.equip(WEAPON_ORDER[n]);
  }

  startReload() {
    if (this.reloading) return false;
    this.reloading = true;
    this.reloadTimer = this.def.reloadTime;
    if (this.audio) this.audio.play('reload');
    return true;
  }

  fireFX() {
    // muzzle flash
    this.flashTime = 0.05;
    const scale = 0.4 + Math.random() * 0.25;
    const s = scale * (this.def.muzzleFlashScale || 1);
    this.flash.scale.set(s, s, 1);
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.material.opacity = 1;
    this.flashLight.intensity = 6 * (this.def.muzzleFlashScale || 1);
    // recoil kick on the model
    this.recoilOffset.z += 0.06 * this.def.recoilVisual / 0.045;
    this.recoilRot.x += this.def.recoilVisual;
    this.recoilRot.y += (Math.random() - 0.5) * this.def.recoilVisual * 0.6;
  }

  getMuzzleWorld(camera, target) {
    // muzzle position in world space (viewmodel is in camera space)
    const local = this.current.userData.muzzle.clone().add(this.current.position);
    target.copy(local).applyMatrix4(camera.matrixWorld);
    return target;
  }

  update(dt, ctx) {
    // ctx: { moveSpeed, aiming, moving, mouseDX, mouseDY, sprinting }
    if (!this.current) return;
    const def = this.def;

    // ADS blend
    const adsTarget = ctx.aiming && !this.reloading ? 1 : 0;
    const adsRate = dt / (def.adsTime || 0.16);
    this.adsBlend += (adsTarget - this.adsBlend) * Math.min(1, adsRate * 3);

    // reload
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) { this.reloading = false; if (this.onReloadDone) this.onReloadDone(); }
    }

    // idle sway from mouse
    const swayX = THREE.MathUtils.clamp(-ctx.mouseDX * 0.00012, -0.03, 0.03);
    const swayY = THREE.MathUtils.clamp(ctx.mouseDY * 0.00012, -0.03, 0.03);
    this.swayPos.x += (swayX - this.swayPos.x) * Math.min(1, dt * 8);
    this.swayPos.y += (swayY - this.swayPos.y) * Math.min(1, dt * 8);
    this.swayRot.y += (-swayX * 6 - this.swayRot.y) * Math.min(1, dt * 8);
    this.swayRot.x += (-swayY * 6 - this.swayRot.x) * Math.min(1, dt * 8);

    // bob
    let bobX = 0, bobY = 0;
    if (ctx.moving && ctx.onGround) {
      const freq = ctx.sprinting ? 13 : 9;
      this.bobPhase += dt * freq;
      const amp = (ctx.sprinting ? 0.03 : 0.016) * (1 - this.adsBlend * 0.7);
      bobX = Math.cos(this.bobPhase) * amp;
      bobY = Math.abs(Math.sin(this.bobPhase)) * amp;
    } else {
      this.bobPhase *= 0.9;
    }

    // recoil spring recover
    this.recoilOffset.multiplyScalar(Math.max(0, 1 - dt * 14));
    this.recoilRot.multiplyScalar(Math.max(0, 1 - dt * 12));

    // equip dip
    let equipDip = 0, equipRot = 0;
    if (this.equipTimer > 0) {
      this.equipTimer -= dt;
      const t = Math.max(0, this.equipTimer / 0.4);
      equipDip = -t * 0.18;
      equipRot = t * 0.5;
    }

    // reload dip
    let reloadDip = 0, reloadRot = 0, magDrop = 0;
    if (this.reloading) {
      const p = 1 - this.reloadTimer / def.reloadTime; // 0..1
      const wave = Math.sin(p * Math.PI);
      reloadDip = -wave * 0.14;
      reloadRot = wave * 0.6;
      // mag drop halfway
      magDrop = p < 0.5 ? (p / 0.5) * -0.12 : (1 - (p - 0.5) / 0.5) * -0.12;
    }
    const mag = this.current.getObjectByName('magazine');
    if (mag && mag.userData.baseY === undefined) mag.userData.baseY = mag.position.y;
    if (mag) mag.position.y = mag.userData.baseY + magDrop;

    // sprint pose
    const sprintBlend = ctx.sprinting ? 1 : 0;
    this._sprint = (this._sprint ?? 0);
    this._sprint += (sprintBlend - this._sprint) * Math.min(1, dt * 8);

    // compose target transform: lerp rest <-> ads
    const rest = this.current.userData.rest;
    const ads = this.current.userData.ads;
    const a = this.adsBlend;
    const px = THREE.MathUtils.lerp(rest.pos.x, ads.pos.x, a);
    const py = THREE.MathUtils.lerp(rest.pos.y, ads.pos.y, a);
    const pz = THREE.MathUtils.lerp(rest.pos.z, ads.pos.z, a);

    const sprintPoseX = this._sprint * 0.06;
    const sprintPoseRZ = this._sprint * 0.5;
    const sprintPoseRX = this._sprint * 0.3;

    this.current.position.set(
      px + this.swayPos.x + bobX + this.recoilOffset.x + sprintPoseX,
      py + this.swayPos.y + bobY + this.recoilOffset.y + equipDip + reloadDip,
      pz + this.recoilOffset.z,
    );
    this.current.rotation.set(
      rest.rot.x + this.swayRot.x + this.recoilRot.x + equipRot + reloadRot + sprintPoseRX,
      rest.rot.y + this.swayRot.y + this.recoilRot.y,
      rest.rot.z + sprintPoseRZ,
    );

    // muzzle flash decay
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flash.material.opacity = Math.max(0, this.flashTime / 0.05);
      this.flashLight.intensity = Math.max(0, (this.flashTime / 0.05) * 6);
      // position flash at muzzle
      const mz = this.current.userData.muzzle;
      this.flash.position.copy(mz).add(this.current.position);
      this.flashLight.position.copy(this.flash.position);
    } else {
      this.flash.material.opacity = 0;
      this.flashLight.intensity = 0;
    }
  }
}
