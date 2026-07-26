/**
 * Weapon definitions — data-driven stats for each firearm. Balanced for a
 * fast, readable combat feel. Damage falls off with distance.
 */
export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'M4-X CARBINE',
    auto: true,
    rpm: 720,               // rounds/min
    damage: 26,
    headshotMult: 2.4,
    magSize: 30,
    reserve: 210,
    reloadTime: 2.1,
    spread: 0.012,          // radians, hip
    adsSpread: 0.0015,
    recoilPitch: 0.028,     // per shot
    recoilYaw: 0.010,
    recoilVisual: 0.045,
    range: 120,
    falloffStart: 40,
    falloffEnd: 100,
    falloffMin: 0.45,
    adsFov: 55,
    adsTime: 0.18,
    tracerEvery: 3,
    pellets: 1,
    muzzleFlashScale: 1.0,
  },
  smg: {
    id: 'smg',
    name: 'VECTOR-9 SMG',
    auto: true,
    rpm: 1050,
    damage: 18,
    headshotMult: 2.0,
    magSize: 40,
    reserve: 280,
    reloadTime: 1.8,
    spread: 0.02,
    adsSpread: 0.004,
    recoilPitch: 0.019,
    recoilYaw: 0.012,
    recoilVisual: 0.03,
    range: 70,
    falloffStart: 20,
    falloffEnd: 55,
    falloffMin: 0.4,
    adsFov: 62,
    adsTime: 0.14,
    tracerEvery: 4,
    pellets: 1,
    muzzleFlashScale: 0.8,
  },
  pistol: {
    id: 'pistol',
    name: 'MK.II SIDEARM',
    auto: false,
    rpm: 360,
    damage: 34,
    headshotMult: 2.2,
    magSize: 15,
    reserve: 90,
    reloadTime: 1.5,
    spread: 0.01,
    adsSpread: 0.002,
    recoilPitch: 0.036,
    recoilYaw: 0.008,
    recoilVisual: 0.06,
    range: 60,
    falloffStart: 18,
    falloffEnd: 45,
    falloffMin: 0.5,
    adsFov: 58,
    adsTime: 0.13,
    tracerEvery: 1,
    pellets: 1,
    muzzleFlashScale: 0.7,
  },
};

export const WEAPON_ORDER = ['rifle', 'smg', 'pistol'];

export function damageAtRange(w, dist) {
  if (dist <= w.falloffStart) return w.damage;
  if (dist >= w.falloffEnd) return w.damage * w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return w.damage * (1 - t * (1 - w.falloffMin));
}
