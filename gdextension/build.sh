#!/usr/bin/env bash
# One-command build for the OVERRIDE GDExtension on Linux.
#
#   ./build.sh                       # auto-detect Godot version, debug build
#   ./build.sh 4.5                   # force godot-cpp branch 4.5
#   ./build.sh 4.5 template_release  # release build
#
# Prereqs (Ubuntu):
#   sudo apt update
#   sudo apt install -y scons python3 build-essential pkg-config git
set -euo pipefail
cd "$(dirname "$0")"

# 1. Pick the godot-cpp branch (arg, else from `godot --version`, else 4.4).
BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
	if command -v godot >/dev/null 2>&1; then
		BRANCH="$(godot --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
	fi
	BRANCH="${BRANCH:-4.4}"
fi
echo ">> Target godot-cpp branch: $BRANCH"

# 2. Fetch the bindings matching your Godot version if not already present.
if [ ! -d godot-cpp ]; then
	echo ">> Cloning godot-cpp ($BRANCH)…"
	git clone -b "$BRANCH" https://github.com/godotengine/godot-cpp
fi

# 3. Compile (also builds godot-cpp itself the first time).
TARGET="${2:-template_debug}"
echo ">> scons target=$TARGET"
scons target="$TARGET" -j"$(nproc)"

echo ""
echo ">> Build complete. Open the 'gdextension/demo/' folder in Godot and press F5."
