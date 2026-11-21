#!/usr/bin/env python3
"""Generate index.html (the HyperFrames composition) for one cut of the release video.

    python3 build.py 16x9    # 1920x1080
    python3 build.py 9x16    # 1080x1920 (social)

Both cuts share the same story (src/beats.json), markup (src/index.tpl) and motion (src/motion.js); only the
layout differs. Footage: each shot is cut from demo-videos/raw/tablet-<a|b>.webm (repo root, git-ignored; override
with FOOTAGE_DIR) into assets/footage/<beat>-<n>.mp4: trimmed, slowed down a little when the slot is longer than the
source, frozen on its last frame, 30 fps H.264 with short GOP so the renderer can seek. Do not edit index.html by hand.
"""
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
RAW = Path(os.environ.get('FOOTAGE_DIR', REPO / 'demo-videos' / 'raw'))
OUT = ROOT / 'assets' / 'footage'
B = json.loads((ROOT / 'src' / 'beats.json').read_text())
TABLET_W, TABLET_H = 1280, 800
MAX_SLOW = 1.6  # never play footage slower than this; the rest of the slot holds the last frame
TABLETS = {'a': 'Tableta de captura', 'b': 'Tableta de estaciones'}

FORMATS = {
    # size of the canvas and inner width of the tablet screen (height follows the 1280x800 ratio)
    '16x9': {'w': 1920, 'h': 1080, 'screen': 1040},
    '9x16': {'w': 1080, 'h': 1920, 'screen': 936},
}

MARK = ('<svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><rect class="tile" x="52" y="52" width="408" height="408" rx="82" fill="#B7426C"/>'
        '<g transform="translate(0 4)" fill="none" stroke="#FFF8F5" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">'
        '<path pathLength="1" d="M115 257c0-119 83-181 141-181s141 62 141 181c0 91-38 150-92 179"/>'
        '<path pathLength="1" d="M142 257c0-99 65-151 114-151s114 52 114 151c0 75-30 123-73 151"/>'
        '<path pathLength="1" d="M169 257c0-77 47-119 87-119s87 42 87 119c0 58-23 96-56 119"/>'
        '<path pathLength="1" d="M197 257c0-55 30-86 59-86s59 31 59 86c0 42-16 69-39 86"/>'
        '<path pathLength="1" d="M224 257c0-31 15-49 32-49s32 18 32 49c0 24-9 39-22 49"/>'
        '<path pathLength="1" d="M256 237c12 0 20 10 20 23 0 12-8 22-20 32-12-10-20-20-20-32 0-13 8-23 20-23z"/></g></svg>')
TAGLINE = 'Una mujer, una huella, un solo expediente, con o sin señal.'


# ---------- timing ----------

def plan():
    """Absolute times for every scene, beat and shot."""
    x = B['xfade']
    t = B['hook']['dur']
    beats = []
    for i, b in enumerate(B['beats']):
        n = len(b['shots'])
        each = b['dur'] / n
        shots = []
        for j, s in enumerate(b['shots']):
            start = t + j * each
            end = t + (j + 1) * each + (x if j == n - 1 else 0.3)
            shots.append(dict(s, id=f'{b["id"]}-{j + 1}', start=round(start, 3), end=round(end, 3)))
        beats.append(dict(b, n=i + 1, start=round(t, 3), end=round(t + b['dur'] + x, 3), shots=shots))
        t += b['dur']
    total = round(t + B['end']['dur'], 3)
    return {'fps': B['fps'], 'xfade': x, 'hook': [0, round(B['hook']['dur'] + x, 3)],
            'stage': [beats[0]['start'], round(t + x, 3)], 'end': [round(t, 3), total], 'total': total, 'beats': beats}


# ---------- footage ----------

def cut(src, dst, start, length, slot):
    """Write `slot` seconds: the source slice (slowed down up to MAX_SLOW) then a freeze of its last frame."""
    slow = max(1.0, min(MAX_SLOW, slot / length))
    pad = max(0.0, slot - length * slow) + 0.5
    vf = (f'setpts={slow:.4f}*(PTS-STARTPTS),fps={B["fps"]},scale={TABLET_W}:{TABLET_H}:flags=lanczos,'
          f'tpad=stop_mode=clone:stop_duration={pad:.3f}')
    key = hashlib.sha1(f'{src.stat().st_mtime}-{start}-{length}-{slot}-{vf}'.encode()).hexdigest()[:12]
    stamp = dst.with_suffix('.key')
    if dst.exists() and stamp.exists() and stamp.read_text() == key:
        return slow
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', str(src),
                    '-vf', vf, '-t', f'{slot:.3f}', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
                    '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(dst)], check=True)
    stamp.write_text(key)
    return slow


def build_footage(p):
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is required to cut the footage (brew install ffmpeg)')
    OUT.mkdir(parents=True, exist_ok=True)
    for b in p['beats']:
        for s in b['shots']:
            src = RAW / f'tablet-{s["tablet"]}.webm'
            if not src.exists():
                sys.exit(f'Missing footage {src}. Copy the demo recording to demo-videos/raw/ or set FOOTAGE_DIR.')
            dst = OUT / f'{s["id"]}.mp4'
            slow = cut(src, dst, s['from'], s['to'] - s['from'], s['end'] - s['start'])
            s['src'] = f'assets/footage/{dst.name}'
            print(f'Footage: {dst.name} {s["to"] - s["from"]:.1f}s of tablet {s["tablet"].upper()} '
                  f'-> {s["end"] - s["start"]:.1f}s slot (x{1 / slow:.2f} speed)')


# ---------- HTML pieces ----------

def win(start, end):
    return f'data-start="{start:.3f}" data-duration="{end - start:.3f}"'


def box_style(b):
    return f'--x:{b[0]};--y:{b[1]};--w:{b[2]};--h:{b[3]}'


def copies(p):
    n = len(p['beats'])
    out = []
    for b in p['beats']:
        out.append(
            f'<div id="copy-{b["id"]}" class="copy clip" {win(b["start"], b["end"])} data-track-index="{10 + b["n"] % 2}" '
            f'style="z-index:{10 + b["n"]}"><div class="copy-in">'
            f'<span class="count"><b>{b["n"]:02d}</b> / {n:02d}</span>'
            f'<h2>{html.escape(b["title"])}</h2><p>{html.escape(b["sub"])}</p></div></div>')
    return '\n        '.join(out)


def shots(p):
    out = []
    k = 0
    for b in p['beats']:
        for s in b['shots']:
            k += 1
            rings = ''.join(f'<i class="ring" style="{box_style(r)}"></i>' for r in s['rings'])
            out.append(
                f'<div id="shot-{s["id"]}" class="shot" style="z-index:{k}" data-focus="{",".join(map(str, s["focus"]))}" '
                f'data-zoom="{s["zoom"]}">'
                f'<div class="cam"><video id="v-{s["id"]}" class="clip" src="{s["src"]}" {win(s["start"], s["end"])} '
                f'data-media-start="0" data-track-index="{20 + k % 2}" muted playsinline></video>{rings}</div>'
                f'<span class="who">{TABLETS[s["tablet"]]}</span></div>')
    return '\n          '.join(out)


def main():
    fmt = sys.argv[1] if len(sys.argv) > 1 else '16x9'
    if fmt not in FORMATS:
        sys.exit(f'usage: build.py {"|".join(FORMATS)}')
    f = FORMATS[fmt]
    p = plan()
    build_footage(p)
    tagline = ' '.join(f'<span class="w">{w}</span>' for w in TAGLINE.split())
    timing = {k: v for k, v in p.items()}
    timing['screen'] = [f['screen'], round(f['screen'] * TABLET_H / TABLET_W, 3)]
    timing['scale'] = f['screen'] / TABLET_W
    timing['format'] = fmt
    reps = {
        '@@W@@': str(f['w']),
        '@@H@@': str(f['h']),
        '@@FMT@@': f'f{fmt.replace("x", "")}',
        '@@ORIENT@@': 'landscape' if f['w'] > f['h'] else 'portrait',
        '@@SCREEN_W@@': str(f['screen']),
        '@@SCALE@@': f'{f["screen"] / TABLET_W:.5f}',
        '@@END@@': f'{p["total"]:.3f}',
        '@@W_hook@@': win(*p['hook']),
        '@@W_end@@': win(*p['end']),
        '@@MARK@@': MARK,
        '@@TAGLINE@@': tagline,
        '@@COPIES@@': copies(p),
        '@@SHOTS@@': shots(p),
        '@@MOTION@@': (ROOT / 'src' / 'motion.js').read_text().replace('__TIMING__', json.dumps(timing, ensure_ascii=False)),
    }
    out = (ROOT / 'src' / 'index.tpl').read_text()
    for k, v in reps.items():
        out = out.replace(k, v)
    if '@@' in out:
        sys.exit('Unreplaced markers in index.tpl')
    (ROOT / 'index.html').write_text(out)
    shots_n = sum(len(b['shots']) for b in p['beats'])
    print(f'index.html ready · {fmt} {f["w"]}x{f["h"]} · {len(p["beats"])} beats · {shots_n} shots · {p["total"]} s')


if __name__ == '__main__':
    main()
