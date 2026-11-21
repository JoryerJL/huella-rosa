#!/usr/bin/env python3
"""Build and render every feature video to renders/NN-slug.mp4 (1920x1080, 30 fps), then print ffprobe facts.

Usage: python3 render_all.py [n ...]     (no arguments = all features with a clip)
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
META = json.loads((REPO / 'scripts' / 'demo' / 'features.json').read_text())
HF = 'hyperframes@0.9.51'


def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
                        '-of', 'json', str(path)], capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    s = d['streams'][0]
    return f'{float(d["format"]["duration"]):.2f} s, {s["width"]}x{s["height"]}, {s["r_frame_rate"]} fps'


def main():
    wanted = {int(a) for a in sys.argv[1:]}
    (ROOT / 'renders').mkdir(exist_ok=True)
    failed = []
    for f in META['features']:
        if wanted and f['n'] not in wanted:
            continue
        name = f'{f["n"]:02d}-{f["slug"]}'
        out = ROOT / 'renders' / f'{name}.mp4'
        try:
            subprocess.run(['python3', 'build.py', str(f['n'])], cwd=ROOT, check=True)
            subprocess.run(['npx', '--yes', HF, 'render', '-q', 'delivery', '-f', '30', '-o', str(out)], cwd=ROOT, check=True,
                           stdout=subprocess.DEVNULL)
            print(f'  ✓ {out.relative_to(REPO)}: {probe(out)}')
        except subprocess.CalledProcessError as e:
            print(f'  ✗ {name}: {e}')
            failed.append(name)
    if failed:
        sys.exit(f'failed: {", ".join(failed)}')


if __name__ == '__main__':
    main()
