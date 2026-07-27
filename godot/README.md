# OVERRIDE — Godot 4 port

A native port of the Three.js FPS to **Godot 4.3+**. Everything (level geometry,
weapons, enemies, HUD) is built procedurally in GDScript — there are no binary
scene assets to import, so the whole game lives in four text files.

## Run it

1. Open **Godot 4.3 or newer**.
2. *Import* → select this `godot/` folder (it contains `project.godot`).
3. Press **F5** (Play).

Controls: **WASD** move · **Shift** sprint · **Ctrl** crouch · **Space** jump ·
**mouse** look · **LMB** fire · **RMB** aim · **R** reload · **1/2/3** weapons ·
**Esc** release mouse.

## Why this should run well

The heavy lifting that made the browser build slow is now the engine's job,
enabled with a few `Environment` flags in `Game.gd::_build_environment()`:
native Vulkan, 4-split cascaded shadows with soft penumbra, SSAO + SSIL,
ACES tonemap, glow/bloom, and depth fog. Tune any of it there.

## Files

| File | Role |
|------|------|
| `project.godot` | Project config + renderer settings |
| `Main.tscn` | One-node entry scene that runs `Game.gd` |
| `scripts/Game.gd` | Environment, level build, HUD, wave director |
| `scripts/Player.gd` | Movement, mouse-look, weapon viewmodel, hitscan |
| `scripts/Enemy.gd` | Soldier model, AI, shooting, damage, death |

## Status / caveats

- **Not yet run in-editor.** This was authored without a Godot binary
  available to compile-check it. If the first launch throws a script error,
  it'll be a small API-name fix — paste me the error text and I'll patch it.
- **No audio yet.** The web build's procedural Web-Audio SFX weren't ported;
  Godot's `AudioStreamGenerator` equivalent is a clean follow-up.
- **Crouch** is simplified (capsule shrink only). Weapon FX are light
  (muzzle flash + impact light flash, no decals/casings yet).
- Tuning knobs worth reaching for first: `sun.light_energy`, `env.ssao_intensity`,
  `env.glow_intensity`, and the per-weapon stats table in `Player.gd`.
