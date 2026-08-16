#!/bin/bash
# Roadmaps — build local sur le MBP (hot-reload HD natif au save de plugin.js).
# Usage : ./build.sh   (depuis ~/.hermes/desktop-plugins/roadmaps/)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/local/bin:$PATH"
/usr/local/bin/node build.mjs
shasum -a 256 plugin.js
echo "→ plugin.js régénéré. HD recharge automatiquement (fs-watch natif)."
