import * as THREE from 'three';

/**
 * Level — builds the playable environment geometry and registers axis-aligned
 * box colliders used by the player and enemies for movement resolution.
 *
 * The map is a semi-arid forward operating base: a central courtyard ringed by
 * buildings, shipping containers, catwalks, sandbag emplacements and scattered
 * hard cover. Layout is authored for readable sightlines and flanking routes.
 */
export class Level {
  constructor(scene, forge) {
    this.scene = scene;
    this.forge = forge;
    this.colliders = [];           // { min:Vector3, max:Vector3 }
    this.solidMeshes = [];         // meshes used for shot/LOS raycasting
    this.root = new THREE.Group();
    this.root.name = 'level';
    scene.add(this.root);
    this.spawnPoints = [];
    this.bounds = { min: new THREE.Vector3(-95, 0, -95), max: new THREE.Vector3(95, 0, 95) };
    this._build();
  }

  _addCollider(mesh, pad = 0) {
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    box.min.subScalar(pad);
    box.max.addScalar(pad);
    this.colliders.push({ min: box.min, max: box.max });
  }

  _box(w, h, d, mat, x, y, z, { collide = true, rotY = 0, cast = true, receive = true } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.setAttribute('uv2', geo.attributes.uv); // for aoMap
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    this.root.add(mesh);
    if (collide) { this._addCollider(mesh); this.solidMeshes.push(mesh); }
    return mesh;
  }

  _build() {
    const F = this.forge;

    // ---- Ground plane (sand) with a subtle undulating heightfield look
    const groundMat = F.sand({ repeat: 40 });
    const groundGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
    groundGeo.setAttribute('uv2', groundGeo.attributes.uv);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    this.solidMeshes.push(ground);

    // Central paved courtyard
    const padMat = F.concrete({ repeat: 12, color: 0.5 });
    const padGeo = new THREE.PlaneGeometry(80, 80);
    padGeo.setAttribute('uv2', padGeo.attributes.uv);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    this.root.add(pad);

    // ---- Perimeter wall
    const wallMat = F.panel({ repeat: 1, tint: [0.42, 0.4, 0.34], seed: 512 });
    const WALL_H = 8, WALL_T = 1.5, EXT = 92;
    const wallSpec = [
      [EXT * 2, WALL_H, WALL_T, 0, WALL_H / 2, -EXT],
      [EXT * 2, WALL_H, WALL_T, 0, WALL_H / 2, EXT],
      [WALL_T, WALL_H, EXT * 2, -EXT, WALL_H / 2, 0],
      [WALL_T, WALL_H, EXT * 2, EXT, WALL_H / 2, 0],
    ];
    for (const [w, h, d, x, y, z] of wallSpec) {
      const panelMat = this._panelUV(wallMat, w, h);
      this._box(w, h, d, panelMat, x, y, z);
    }

    // ---- Buildings (blockout with detailed materials)
    const bMat = F.concrete({ repeat: 4, color: 0.58, seed: 777 });
    const trimMat = F.metal({ repeat: 2, tint: [0.3, 0.32, 0.35], seed: 888, rough: 0.5 });
    this._building(-52, -40, 24, 14, 18, bMat, trimMat);
    this._building(50, -46, 20, 10, 22, bMat, trimMat);
    this._building(58, 42, 28, 16, 20, bMat, trimMat);
    this._building(-56, 46, 22, 12, 16, bMat, trimMat);

    // ---- Central control tower with catwalk & glowing panels
    this._tower(0, 0, F);

    // ---- Shipping containers (cover + verticality)
    const contColors = [[0.55, 0.34, 0.14], [0.32, 0.5, 0.58], [0.62, 0.52, 0.2], [0.5, 0.2, 0.2]];
    const contLayout = [
      [-20, -18, 0], [-20, -12.5, 0], [-14.6, -15, Math.PI / 2],
      [22, 15, 0], [27.5, 15, 0], [24.7, 20.4, Math.PI / 2],
      [-26, 22, Math.PI / 6], [30, -22, -Math.PI / 8],
      [8, -30, 0], [-8, 30, Math.PI / 2],
    ];
    contLayout.forEach((c, i) => {
      const col = contColors[i % contColors.length];
      this._container(c[0], c[1], c[2], col, F, 600 + i);
    });

    // Stacked container = sniper perch
    this._container(-20, -18, 0, contColors[1], F, 651, 2.7);

    // ---- Sandbag emplacements
    const bagMat = F.sand({ repeat: 2, seed: 909 });
    this._sandbagLine(-6, -8, 0, 6, bagMat);
    this._sandbagLine(10, 6, Math.PI / 2, 5, bagMat);
    this._sandbagLine(-14, 10, -Math.PI / 5, 4, bagMat);

    // ---- Scattered crates
    const crateMat = F.panel({ repeat: 1, tint: [0.5, 0.4, 0.22], seed: 333 });
    const crateSpots = [
      [15, -8, 0.7], [17, -6, 0.7], [16, -7, 1.4],
      [-32, 4, 0.7], [-30, 6, 0.7], [-31, 5, 1.4],
      [4, 18, 0.7], [6, 20, 0.7],
      [-4, -24, 0.7], [36, 8, 0.7],
    ];
    for (const [x, z, s] of crateSpots) {
      this._box(1.4, 1.4, 1.4, crateMat, x, s, z, { rotY: Math.random() * 0.4 });
    }

    // ---- Barrels (clustered)
    const barrelMat = F.metal({ repeat: 2, tint: [0.5, 0.2, 0.12], seed: 1001, rough: 0.35 });
    const barrelSpots = [[-38, -8], [-36, -9], [-37, -7], [42, 24], [40, 26], [12, 34]];
    for (const [x, z] of barrelSpots) this._barrel(x, z, barrelMat);

    // ---- Spawn points for enemies (around the perimeter / behind cover)
    this.spawnPoints = [
      new THREE.Vector3(-70, 0, -70), new THREE.Vector3(70, 0, -70),
      new THREE.Vector3(70, 0, 70), new THREE.Vector3(-70, 0, 70),
      new THREE.Vector3(0, 0, -80), new THREE.Vector3(0, 0, 80),
      new THREE.Vector3(-80, 0, 0), new THREE.Vector3(80, 0, 0),
      new THREE.Vector3(-40, 0, 30), new THREE.Vector3(40, 0, -30),
    ];
  }

  _panelUV(mat, w, h) {
    const m = mat.clone();
    if (m.map) { m.map = m.map.clone(); m.map.repeat.set(w / 6, h / 6); m.map.needsUpdate = true; }
    return mat; // keep shared to save memory; UV scaling handled by geometry
  }

  _building(x, z, w, d, h, bodyMat, trimMat) {
    // main body (hollow feel via trim)
    this._box(w, h, d, bodyMat, x, h / 2, z);
    // roof trim
    this._box(w + 1, 0.6, d + 1, trimMat, x, h + 0.3, z, { collide: false });
    // door recess (emissive interior glow)
    const glow = this.forge.emissive(0xffcf8a, 1.4);
    this._box(2.4, 3.2, 0.3, glow, x, 1.6, z + d / 2 + 0.05, { collide: false, cast: false });
    // windows
    const glass = this.forge.glass();
    for (let i = -1; i <= 1; i++) {
      this._box(1.6, 1.4, 0.2, glass, x + i * 4.5, h * 0.62, z + d / 2 + 0.06, { collide: false, cast: false });
    }
    // AC unit / roof detail
    const acMat = this.forge.metal({ repeat: 1, tint: [0.5, 0.5, 0.52], seed: 1201, rough: 0.4 });
    this._box(2.2, 1.2, 2.2, acMat, x + w / 4, h + 0.9, z - d / 4, { collide: false });
  }

  _tower(x, z, F) {
    const bodyMat = F.concrete({ repeat: 3, color: 0.55, seed: 1301 });
    const steelMat = F.metal({ repeat: 3, tint: [0.28, 0.3, 0.33], seed: 1302, rough: 0.45 });
    // base
    this._box(8, 14, 8, bodyMat, x, 7, z);
    // observation deck
    this._box(12, 1, 12, steelMat, x, 14.5, z);
    // railings (emissive tech trim)
    const trim = F.emissive(0x33e0c0, 2.2);
    this._box(12, 0.15, 0.2, trim, x, 15.6, z + 6, { collide: false, cast: false });
    this._box(12, 0.15, 0.2, trim, x, 15.6, z - 6, { collide: false, cast: false });
    this._box(0.2, 0.15, 12, trim, x + 6, 15.6, z, { collide: false, cast: false });
    this._box(0.2, 0.15, 12, trim, x - 6, 15.6, z, { collide: false, cast: false });
    // antenna
    this._box(0.3, 8, 0.3, steelMat, x + 4, 19, z + 4, { collide: false });
    const beacon = F.emissive(0xff3b4e, 3.0);
    this._box(0.5, 0.5, 0.5, beacon, x + 4, 23.2, z + 4, { collide: false, cast: false });
  }

  _container(x, z, rotY, col, F, seed, yBase = 0) {
    const mat = F.panel({ repeat: 1, tint: col, seed });
    const W = 6.06, H = 2.59, D = 2.44;
    this._box(W, H, D, mat, x, yBase + H / 2, z, { rotY });
  }

  _sandbagLine(x, z, rot, count, mat) {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.7, 4, 8), mat);
      bag.rotation.z = Math.PI / 2;
      bag.position.set((i - count / 2) * 0.85, 0.35, 0);
      bag.castShadow = bag.receiveShadow = true;
      // second row on top, offset
      const bag2 = bag.clone();
      bag2.position.y = 0.95;
      bag2.position.x += 0.42;
      group.add(bag, bag2);
    }
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    this.root.add(group);
    // collider approximation
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group);
    this.colliders.push({ min: box.min, max: box.max });
  }

  _barrel(x, z, mat) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 20), mat);
    barrel.position.set(x, 0.75, z);
    barrel.castShadow = barrel.receiveShadow = true;
    this.root.add(barrel);
    this.solidMeshes.push(barrel);
    // rings
    const ringMat = mat;
    for (const ry of [-0.4, 0, 0.4]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.51, 0.04, 6, 20), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.75 + ry, z);
      this.root.add(ring);
    }
    this.colliders.push({
      min: new THREE.Vector3(x - 0.55, 0, z - 0.55),
      max: new THREE.Vector3(x + 0.55, 1.5, z + 0.55),
    });
  }

  // Resolve a capsule (radius r, from feet y to head) against colliders.
  // Returns adjusted position. Simple swept-AABB horizontal + vertical.
  collide(pos, radius, height) {
    const p = pos.clone();
    for (const c of this.colliders) {
      // expand AABB by radius on x/z
      const minX = c.min.x - radius, maxX = c.max.x + radius;
      const minZ = c.min.z - radius, maxZ = c.max.z + radius;
      const footY = p.y - height, headY = p.y;
      // vertical overlap?
      if (headY < c.min.y || footY > c.max.y) continue;
      if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
        // push out along smallest penetration axis
        const dxL = p.x - minX, dxR = maxX - p.x;
        const dzL = p.z - minZ, dzR = maxZ - p.z;
        const m = Math.min(dxL, dxR, dzL, dzR);
        if (m === dxL) p.x = minX;
        else if (m === dxR) p.x = maxX;
        else if (m === dzL) p.z = minZ;
        else p.z = maxZ;
      }
    }
    // world bounds
    p.x = Math.max(this.bounds.min.x + radius, Math.min(this.bounds.max.x - radius, p.x));
    p.z = Math.max(this.bounds.min.z + radius, Math.min(this.bounds.max.z - radius, p.z));
    return p;
  }

  // Height of the nearest surface directly under a point (for step-up / standing).
  groundHeight(x, z, fromY) {
    let best = 0;
    for (const c of this.colliders) {
      if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) {
        if (c.max.y <= fromY + 0.6 && c.max.y > best) best = c.max.y;
      }
    }
    return best;
  }
}
