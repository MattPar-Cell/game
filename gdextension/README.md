# OVERRIDE — C++ / GDExtension port

The FPS reimplemented as a native **GDExtension** in C++ (`godot-cpp`). The
three game classes — `Game`, `Player`, `Enemy` — compile into a shared library
that Godot loads; `demo/Main.tscn` is just a single `Game` node.

> **C++ does not "just run" in Godot.** Unlike GDScript, you must compile this
> into a native library first, with a C++ toolchain. Steps below.

## Prerequisites

- **Godot 4.3+** (match the `godot-cpp` branch to your exact version).
- **SCons** (`pip install scons`) and a C++17 compiler:
  - Linux: `gcc`/`clang`
  - Windows: Visual Studio Build Tools (MSVC) or MinGW
  - macOS: Xcode command-line tools

## Build

```bash
cd gdextension

# 1. Fetch the bindings for YOUR Godot version (e.g. 4.3). Use the matching branch.
git clone -b 4.3 https://github.com/godotengine/godot-cpp

# 2. Compile the extension (this also builds godot-cpp the first time).
scons target=template_debug          # debug build
# scons target=template_release      # optimized build
```

The library lands in `demo/bin/` with a name like
`liboverride.linux.template_debug.x86_64.so` — exactly what
`demo/override.gdextension` points at.

## Run

Open the **`demo/`** folder in Godot 4.3+ and press **F5**. Godot loads the
extension via `override.gdextension`, and `Main.tscn` (a `Game` node) boots the
whole thing.

Controls: **WASD** move · **Shift** sprint · **Ctrl** crouch · **Space** jump ·
**mouse** look · **LMB** fire · **RMB** aim · **R** reload · **1/2/3** weapons ·
**Esc** release mouse.

## Files

| File | Role |
|------|------|
| `src/register_types.cpp` | GDExtension entry point + class registration |
| `src/game.{h,cpp}` | Environment, level, HUD, wave director |
| `src/player.{h,cpp}` | Movement, mouse-look, weapon viewmodel, hitscan |
| `src/enemy.{h,cpp}` | Soldier model, AI, damage, death |
| `SConstruct` | Build script (invokes `godot-cpp/SConstruct`) |
| `demo/override.gdextension` | Tells Godot which library to load per platform |
| `demo/Main.tscn` / `project.godot` | Minimal project that runs a `Game` node |

## Design notes / caveats

- **Not compiler-verified.** This was written without a C++/Godot toolchain in
  the authoring environment, so it has *not* been built. Expect to iterate on a
  few compile errors on first build (most likely: an exact `godot-cpp` API
  name, an enum path, or an include). Paste the compiler output and it's a
  quick fix.
- Resource configuration uses Godot's generic `object->set("property", value)`
  (property names are stable across versions) instead of dozens of individual
  C++ setters, to reduce version-specific breakage.
- Input actions are registered at runtime in `Game::register_input()`, so no
  input map lives in `project.godot`.
- No audio yet; weapon FX are light (muzzle-flash + impact light-flash). These
  are clean follow-ups.
- If your Godot is not 4.3, change the `git clone -b <ver>` branch **and** the
  `compatibility_minimum` in `demo/override.gdextension` to match.
```
