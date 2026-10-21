#!/usr/bin/env bash
# Rebuilds how-it-works.png and how-it-works.gif from how-it-works.html (needs google-chrome and ffmpeg).
set -euo pipefail
cd "$(dirname "$0")"
frames=$(mktemp -d)
trap 'rm -rf "$frames"' EXIT
shot() { google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor="${3:-1}" \
  --window-size=1200,800 --virtual-time-budget=3000 --screenshot="$1" "file://$PWD/how-it-works.html?$2" 2>/dev/null; }

shot "$PWD/how-it-works.png" "step=0" 2
shot "$frames/s0.png" "step=0"
for s in 1 2 3 4 5 6 7; do for f in 0 1 2 3; do shot "$frames/s${s}f${f}.png" "step=$s&f=$f"; done; done

# Overview 3 s, then each step loops its 4 dash frames for 3.6 s, then the overview again.
list="$frames/list.txt"
{ echo "file 's0.png'"; echo "duration 3"
  for s in 1 2 3 4 5 6 7; do for _ in $(seq 1 9); do for f in 0 1 2 3; do echo "file 's${s}f${f}.png'"; echo "duration 0.1"; done; done; done
  echo "file 's0.png'"; echo "duration 3"; echo "file 's0.png'"; } > "$list"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" \
  -vf "fps=10,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 how-it-works.gif
echo "Wrote how-it-works.png and how-it-works.gif"
