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
    const bMat = F.concrete({ repeat: 2, color: 0.58, seed: 777 });
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

    // ---- Scattered rocks & rubble to break the flat ground / hide tiling
    this._scatterDebris(F);

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
    // main mass
    this._box(w, h, d, bodyMat, x, h / 2, z);
    // setback secondary mass on the roof — breaks the flat silhouette
    const w2 = w * 0.55, d2 = d * 0.55, h2 = h * 0.32;
    this._box(w2, h2, d2, bodyMat, x - w * 0.14, h + h2 / 2, z - d * 0.12, { collide: false });
    // base plinth + roof parapet (reads as beveled trim, catches edge light)
    this._box(w + 0.5, 0.7, d + 0.5, trimMat, x, 0.35, z, { collide: false });
    this._box(w + 0.4, 0.55, d + 0.4, trimMat, x, h + 0.28, z, { collide: false });
    this._box(w2 + 0.3, 0.35, d2 + 0.3, trimMat, x - w * 0.14, h + h2 + 0.15, z - d * 0.12, { collide: false });
    // corner pilasters
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this._box(0.45, h, 0.45, trimMat, x + sx * (w / 2 - 0.05), h / 2, z + sz * (d / 2 - 0.05), { collide: false });
    }

    // ---- facade windows (recessed frame + dark/lit glass) on all 4 faces
    const frameMat = trimMat;
    const darkGlass = this._winDark || (this._winDark = new THREE.MeshStandardMaterial({
      color: 0x0a0e13, roughness: 0.18, metalness: 0.55, envMapIntensity: 1.2,
    }));
    const rows = Math.max(1, Math.floor((h - 3) / 3.2));
    const place = (fw, cx, cz, nx, nz) => {
      const cols = Math.max(1, Math.floor((fw - 1.5) / 2.6));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const along = (c - (cols - 1) / 2) * 2.6;
          const wy = 2.6 + r * 3.2;
          const px = cx + (-nz) * along + nx * 0.06;
          const pz = cz + (nx) * along + nz * 0.06;
          const lit = Math.random() < 0.3;
          const gm = lit ? this.forge.emissive(0xffcb82, 1.1) : darkGlass;
          // frame
          this._box(Math.abs(nx) ? 0.22 : 1.5, 1.7, Math.abs(nz) ? 0.22 : 1.5, frameMat, px, wy, pz, { collide: false, cast: false });
          // glass slightly inset
          const gx = cx + (-nz) * along + nx * -0.02;
          const gz = cz + (nx) * along + nz * -0.02;
          this._box(Math.abs(nx) ? 0.1 : 1.2, 1.35, Math.abs(nz) ? 0.1 : 1.2, gm, gx, wy, gz, { collide: false, cast: false });
        }
      }
    };
    place(w, x, z + d / 2, 0, 1);
    place(w, x, z - d / 2, 0, -1);
    place(d, x + w / 2, z, 1, 0);
    place(d, x - w / 2, z, -1, 0);

    // door recess with warm interior glow
    const glow = this.forge.emissive(0xffcf8a, 1.3);
    this._box(2.4, 3.2, 0.2, frameMat, x, 1.6, z + d / 2 + 0.04, { collide: false, cast: false });
    this._box(2.0, 2.9, 0.12, glow, x, 1.5, z + d / 2 + 0.1, { collide: false, cast: false });

    // rooftop AC units + vent pipe greebles
    const acMat = this.forge.metal({ repeat: 1, tint: [0.42, 0.43, 0.45], seed: 1201, rough: 0.45 });
    this._box(2.0, 1.1, 1.6, acMat, x + w / 4, h + 0.55, z + d / 4, { collide: false });
    this._box(0.35, 2.2, 0.35, acMat, x - w / 3, h + 1.1, z + d / 3, { collide: false });
    this._box(0.35, 1.4, 0.35, acMat, x - w / 3 + 0.5, h + 0.7, z + d / 3, { collide: false });
  }

  _tower(x, z, F) {
    const bodyMat = F.concrete({ repeat: 3, color: 0.55, seed: 1301 });
    const steelMat = F.metal({ repeat: 3, tint: [0.28, 0.3, 0.33], seed: 1302, rough: 0.45 });
    // base
    this._box(8, 14, 8, bodyMat, x, 7, z);
    // observation deck + underside soffit (so it isn't a black slab)
    this._box(12, 1, 12, steelMat, x, 14.5, z);
    this._box(11, 0.3, 11, bodyMat, x, 13.9, z, { collide: false });
    // painted metal railings (top rail + posts) — no neon
    const rail = steelMat;
    for (const [dx, dz, rw, rd] of [[0, 6, 12, 0.16], [0, -6, 12, 0.16], [6, 0, 0.16, 12], [-6, 0, 0.16, 12]]) {
      this._box(rw, 0.14, rd, rail, x + dx, 16.1, z + dz, { collide: false });
      for (let i = -2; i <= 2; i++) {
        const px = x + dx + (rd > rw ? 0 : i * 2.6);
        const pz = z + dz + (rd > rw ? i * 2.6 : 0);
        this._box(0.1, 1.5, 0.1, rail, px, 15.35, pz, { collide: false });
      }
    }
    // antenna mast + small red aviation beacon (kept tiny/plausible)
    this._box(0.3, 8, 0.3, steelMat, x + 4, 19, z + 4, { collide: false });
    const beacon = F.emissive(0xff3b4e, 2.4);
    this._box(0.28, 0.28, 0.28, beacon, x + 4, 23.1, z + 4, { collide: false, cast: false });
  }

  _container(x, z, rotY, col, F, seed, yBase = 0) {
    const mat = F.panel({ repeat: 1, tint: col, seed });
    const W = 6.06, H = 2.59, D = 2.44;
    this._box(W, H, D, mat, x, yBase + H / 2, z, { rotY });
  }

  _sandbagLine(x, z, rot, count, mat) {
    const group = new THREE.Group();
    const rnd = (a, b) => a + Math.random() * (b - a);
    // three staggered rows of individually-varied bags for a lumpy wall
    for (let row = 0; row < 3; row++) {
      const y = 0.32 + row * 0.5;
      const offX = (row % 2) * 0.42;
      const n = count - row;
      for (let i = 0; i < n; i++) {
        const rad = rnd(0.28, 0.36), len = rnd(0.55, 0.78);
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 5, 10), mat);
        bag.rotation.z = Math.PI / 2 + rnd(-0.12, 0.12);
        bag.rotation.y = rnd(-0.15, 0.15);
        bag.position.set((i - n / 2) * 0.82 + offX, y + rnd(-0.04, 0.04), rnd(-0.06, 0.06));
        // squash slightly so bags sag rather than read as smooth tubes
        bag.scale.set(1, rnd(0.82, 0.95), rnd(0.9, 1.05));
        bag.castShadow = bag.receiveShadow = true;
        group.add(bag);
      }
    }
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    this.root.add(group);
    // collider approximation
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group);
    this.colliders.push({ min: box.min, max: box.max });
  }

  _scatterDebris(F) {
    const rockMat = F.concrete({ repeat: 1, color: 0.42, seed: 2201 });
    const sandRockMat = F.sand({ repeat: 1, seed: 2202 });
    // deform an icosahedron once, reuse for all rocks (cheap variety via scale)
    const baseGeo = new THREE.IcosahedronGeometry(1, 1);
    const pos = baseGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const f = 0.7 + Math.random() * 0.5;
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
    }
    baseGeo.computeVertexNormals();

    const group = new THREE.Group();
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 70; i++) {
      // bias away from dead center (courtyard), keep inside walls
      let rx, rz;
      do { rx = rnd(-85, 85); rz = rnd(-85, 85); } while (Math.hypot(rx, rz) < 10);
      const mat = Math.random() < 0.5 ? rockMat : sandRockMat;
      const rock = new THREE.Mesh(baseGeo, mat);
      const s = rnd(0.15, 0.7);
      rock.scale.set(s * rnd(0.8, 1.3), s * rnd(0.5, 0.9), s * rnd(0.8, 1.3));
      rock.position.set(rx, s * 0.35, rz);
      rock.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      rock.castShadow = rock.receiveShadow = true;
      group.add(rock);
    }
    // gravel piles (clusters of tiny rocks) near a few cover points
    for (const [cx, cz] of [[16, -7], [-31, 5], [24, 18]]) {
      for (let i = 0; i < 8; i++) {
        const rock = new THREE.Mesh(baseGeo, rockMat);
        const s = rnd(0.1, 0.28);
        rock.scale.setScalar(s);
        rock.position.set(cx + rnd(-1.2, 1.2), s * 0.4, cz + rnd(-1.2, 1.2));
        rock.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
        rock.castShadow = rock.receiveShadow = true;
        group.add(rock);
      }
    }
    this.root.add(group);
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
