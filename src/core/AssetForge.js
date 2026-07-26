import * as THREE from 'three';

/**
 * AssetForge — procedurally generates all textures and materials at runtime.
 *
 * Everything here is authored in code (no external image downloads) so the
 * game is fully self-contained, yet still uses physically-based rendering:
 * albedo + normal + roughness + metalness + AO maps built from layered noise.
 */

// ------------------------------------------------------------------ noise
// Deterministic value-noise + fBm used across all texture generators.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fract(x) { return x - Math.floor(x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise2D(seed) {
  const rng = makeRng(seed);
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return (x, y) => {
    x = ((x % size) + size) % size;
    y = ((y % size) + size) % size;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const v00 = grid[y0 * size + x0], v10 = grid[y0 * size + x1];
    const v01 = grid[y1 * size + x0], v11 = grid[y1 * size + x1];
    return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
  };
}

function fbm(noise, x, y, octaves = 5, lac = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;
}

// Build a normal map from a heightfield (Sobel).
function heightToNormal(height, w, h, strength = 2.0) {
  const data = new Uint8Array(w * h * 4);
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = at(x - 1, y), r = at(x + 1, y);
      const u = at(x, y - 1), d = at(x, y + 1);
      const dx = (l - r) * strength;
      const dy = (u - d) * strength;
      const nz = 1.0;
      const len = Math.hypot(dx, dy, nz) || 1;
      const i = (y * w + x) * 4;
      data[i]     = (dx / len * 0.5 + 0.5) * 255;
      data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function makeTexture(data, w, h, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generate a full PBR material set (albedo/normal/roughness/ao) from a
 * per-pixel authoring callback.
 *
 * cb(x, y, u, v, noise, fbmFn) must return
 *   { r,g,b, height, rough, ao, metal }  (0..1 each)
 */
function forgePBR(size, seed, cb, opts = {}) {
  const noise = valueNoise2D(seed);
  const fbmFn = (x, y, o, l, g) => fbm(noise, x, y, o, l, g);
  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const N = size * size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const o = cb(x, y, u, v, noise, fbmFn);
      const i4 = i * 4;
      albedo[i4] = Math.max(0, Math.min(1, o.r)) * 255;
      albedo[i4 + 1] = Math.max(0, Math.min(1, o.g)) * 255;
      albedo[i4 + 2] = Math.max(0, Math.min(1, o.b)) * 255;
      albedo[i4 + 3] = 255;
      height[i] = o.height ?? 0.5;
      const rr = Math.max(0, Math.min(1, o.rough ?? 0.8)) * 255;
      const ao = Math.max(0, Math.min(1, o.ao ?? 1)) * 255;
      const metal = Math.max(0, Math.min(1, o.metal ?? 0)) * 255;
      // pack: R=metal, G=roughness, B=ao  (used with separate maps below)
      rough[i4] = metal;
      rough[i4 + 1] = rr;
      rough[i4 + 2] = ao;
      rough[i4 + 3] = 255;
    }
  }
  void N;

  const normalData = heightToNormal(height, size, size, opts.normalStrength ?? 2.5);

  // split roughness / metal / ao into standalone single-channel-ish textures
  const roughTex = new Uint8Array(size * size * 4);
  const metalTex = new Uint8Array(size * size * 4);
  const aoTex = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const i4 = i * 4;
    const m = rough[i4], r = rough[i4 + 1], a = rough[i4 + 2];
    roughTex[i4] = roughTex[i4 + 1] = roughTex[i4 + 2] = r; roughTex[i4 + 3] = 255;
    metalTex[i4] = metalTex[i4 + 1] = metalTex[i4 + 2] = m; metalTex[i4 + 3] = 255;
    aoTex[i4] = aoTex[i4 + 1] = aoTex[i4 + 2] = a; aoTex[i4 + 3] = 255;
  }

  const repeat = opts.repeat ?? 1;
  const aniso = opts.aniso ?? 8;
  return {
    map: makeTexture(albedo, size, size, { srgb: true, repeat, aniso }),
    normalMap: makeTexture(normalData, size, size, { repeat, aniso }),
    roughnessMap: makeTexture(roughTex, size, size, { repeat, aniso }),
    metalnessMap: makeTexture(metalTex, size, size, { repeat, aniso }),
    aoMap: makeTexture(aoTex, size, size, { repeat, aniso }),
  };
}

export class AssetForge {
  constructor() {
    this.cache = new Map();
  }

  _mat(key, factory) {
    if (this.cache.has(key)) return this.cache.get(key);
    const m = factory();
    this.cache.set(key, m);
    return m;
  }

  // Weathered concrete for floors/walls.
  concrete({ repeat = 6, color = 0.62, seed = 101 } = {}) {
    return this._mat(`concrete-${repeat}-${color}-${seed}`, () => {
      const maps = forgePBR(512, seed, (x, y, u, v, noise, F) => {
        const base = color;
        // fine surface grain
        const grain = (F(x * 0.09, y * 0.09, 6) - 0.5) * 0.09;
        // broad tonal mottling (patchy pours) — richer now
        const mottle = (F(x * 0.005, y * 0.005, 4) - 0.5) * 0.18;
        // dark oil / weathering stains
        const stain = Math.pow(F(x * 0.018, y * 0.018, 3), 2.2) * 0.16;
        // patchy sand-dust drift blown across the slab (warm, lighter)
        const dust = Math.pow(F(x * 0.012, y * 0.012 + 17, 3), 1.8);
        // occasional aggregate specks
        const speck = noise(x * 1.3, y * 1.3) > 0.992 ? -0.12 : 0;
        // SPARSE hairline cracks masked to isolated fractures
        const crackMask = F(x * 0.008, y * 0.008 + 40, 2);
        const crackLine = Math.abs(F(x * 0.04, y * 0.04, 4) - 0.5) < 0.005;
        const crack = (crackLine && crackMask > 0.78) ? -0.08 : 0;
        let c = base + grain + mottle - stain + speck + crack;
        // blend toward warm sand where dust drift is strong
        const d = Math.max(0, dust - 0.5) * 0.7;
        const r = c * 1.0 * (1 - d) + (c + 0.06) * 1.08 * d;
        const g = c * 0.98 * (1 - d) + (c + 0.03) * 0.98 * d;
        const b = c * 0.95 * (1 - d) + (c - 0.04) * 0.78 * d;
        const rough = 0.86 + grain * 0.4 + stain * 0.2 + d * 0.1;
        return {
          r, g, b,
          height: 0.5 + grain * 1.2 + crack * 1.4 + speck * 2,
          rough: Math.min(1, rough), ao: 1 - stain * 0.5 + crack * 0.8, metal: 0,
        };
      }, { repeat, normalStrength: 1.4 });
      return new THREE.MeshStandardMaterial({
        ...maps, roughness: 1, metalness: 0.02, aoMapIntensity: 1,
        normalScale: new THREE.Vector2(0.7, 0.7),
      });
    });
  }

  // Brushed / scratched painted metal for crates, structures.
  metal({ repeat = 3, tint = [0.36, 0.4, 0.44], seed = 202, rough = 0.42 } = {}) {
    return this._mat(`metal-${repeat}-${tint}-${seed}-${rough}`, () => {
      const maps = forgePBR(512, seed, (x, y, u, v, noise, F) => {
        const brush = Math.sin(x * 0.5 + F(x * 0.02, y * 0.4, 3) * 6) * 0.04;
        const scr = noise(x * 1.4, y * 0.3) > 0.97 ? 0.3 : 0;
        const rust = Math.pow(F(x * 0.02, y * 0.02, 5), 3) * 0.4;
        const edge = F(x * 0.01, y * 0.01, 2);
        return {
          r: tint[0] * (1 - rust) + 0.34 * rust + brush + scr,
          g: tint[1] * (1 - rust) + 0.2 * rust + brush + scr,
          b: tint[2] * (1 - rust) + 0.12 * rust + brush + scr,
          height: 0.5 + brush * 3 + scr,
          rough: rough + rust * 0.5 - scr * 0.3, ao: 1 - rust * 0.4,
          metal: 0.9 - rust * 0.85,
        };
      }, { repeat, normalStrength: 1.2 });
      return new THREE.MeshStandardMaterial({
        ...maps, roughness: 1, metalness: 1,
        normalScale: new THREE.Vector2(0.5, 0.5),
      });
    });
  }

  // Asphalt / tarmac ground.
  asphalt({ repeat = 14, seed = 303 } = {}) {
    return this._mat(`asphalt-${repeat}-${seed}`, () => {
      const maps = forgePBR(512, seed, (x, y, u, v, noise, F) => {
        const gravel = F(x * 0.25, y * 0.25, 6);
        const speck = noise(x * 2, y * 2);
        let c = 0.09 + gravel * 0.09 + (speck > 0.8 ? speck * 0.15 : 0);
        const crack = Math.abs(F(x * 0.02, y * 0.02, 3) - 0.5) < 0.008 ? -0.05 : 0;
        return {
          r: c + 0.01, g: c, b: c * 1.05,
          height: 0.5 + gravel * 1.5 + crack * 3,
          rough: 0.92 - gravel * 0.2, ao: 1 - gravel * 0.2 + crack, metal: 0,
        };
      }, { repeat, normalStrength: 2.2 });
      return new THREE.MeshStandardMaterial({
        ...maps, roughness: 1, metalness: 0,
        normalScale: new THREE.Vector2(1.0, 1.0),
      });
    });
  }

  // Sand / desert ground.
  sand({ repeat = 20, seed = 404 } = {}) {
    return this._mat(`sand-${repeat}-${seed}`, () => {
      const maps = forgePBR(512, seed, (x, y, u, v, noise, F) => {
        // lower-frequency ripples with heavy phase break to kill the periodic
        // specular glints that otherwise line up along the horizon
        const ripple = (Math.sin(x * 0.18 + F(x * 0.03, y * 0.05, 4) * 7) * 0.5 + 0.5);
        const grain = F(x * 0.22, y * 0.22, 4);
        const fine = (noise(x * 1.3, y * 1.3) - 0.5);   // per-grain sparkle
        const dune = F(x * 0.02, y * 0.02, 3);
        let c = 0.5 + ripple * 0.06 + grain * 0.05 + (dune - 0.5) * 0.08 + fine * 0.05;
        return {
          r: c * 1.03, g: c * 0.93, b: c * 0.69,
          height: 0.5 + ripple * 0.8 + grain * 0.6 + fine * 0.5,
          rough: 0.95, ao: 1 - (1 - ripple) * 0.12, metal: 0,
        };
      }, { repeat, normalStrength: 1.0, aniso: 16 });
      return new THREE.MeshStandardMaterial({
        ...maps, roughness: 1, metalness: 0,
        normalScale: new THREE.Vector2(0.4, 0.4),
      });
    });
  }

  // Rusted / painted shipping-container style panel with rivets.
  panel({ repeat = 1, tint = [0.5, 0.42, 0.2], seed = 505 } = {}) {
    return this._mat(`panel-${repeat}-${tint}-${seed}`, () => {
      const maps = forgePBR(512, seed, (x, y, u, v, noise, F) => {
        // corrugation
        const corr = Math.sin(u * Math.PI * 2 * 12) * 0.5 + 0.5;
        // rivets on a grid
        const gx = (u * 6) % 1, gy = (v * 6) % 1;
        const rd = Math.hypot(gx - 0.5, gy - 0.5);
        const rivet = rd < 0.06 ? 0.25 : 0;
        const rust = Math.pow(F(x * 0.03, y * 0.03, 5), 3.0) * 0.4;
        const scr = noise(x * 1.1, y * 0.4) > 0.98 ? 0.18 : 0;
        return {
          r: tint[0] * (1 - rust) + 0.42 * rust + rivet + scr,
          g: tint[1] * (1 - rust) + 0.24 * rust + rivet + scr,
          b: tint[2] * (1 - rust) + 0.14 * rust + rivet + scr,
          height: 0.35 + corr * 0.4 + rivet * 2,
          ao: 1 - rust * 0.25 - (1 - corr) * 0.08,
          // painted steel: paint is dielectric (low metalness) so shadowed
          // faces still catch diffuse skylight; rust patches turn metallic
          rough: 0.5 + rust * 0.35,
          metal: 0.1 + rust * 0.5,
        };
      }, { repeat, normalStrength: 3.0 });
      return new THREE.MeshStandardMaterial({
        ...maps, roughness: 1, metalness: 1, envMapIntensity: 1.0,
        normalScale: new THREE.Vector2(1.1, 1.1),
      });
    });
  }

  // Emissive warning stripe / tech material.
  emissive(color = 0x33e0c0, intensity = 2.0) {
    return this._mat(`emissive-${color}-${intensity}`, () =>
      new THREE.MeshStandardMaterial({
        color: 0x0a0d12, emissive: new THREE.Color(color),
        emissiveIntensity: intensity, roughness: 0.4, metalness: 0.6,
      }));
  }

  // Glass.
  glass() {
    return this._mat('glass', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x8899aa, metalness: 0, roughness: 0.05,
        transmission: 0.9, transparent: true, opacity: 0.35,
        ior: 1.45, thickness: 0.5, reflectivity: 0.5,
      }));
  }
}

export const heightNormalUtil = { valueNoise2D, fbm };
