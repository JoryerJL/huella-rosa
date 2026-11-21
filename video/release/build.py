#!/usr/bin/env python3
"""Generate index.html (the HyperFrames composition) for one cut of the release video.

    python3 build.py 16x9    # 1920x1080
    python3 build.py 9x16    # 1080x1920 (social)

Both cuts share the same story (src/beats.json), markup (src/index.tpl) and motion (src/motion.js); only the
layout differs. Footage: each shot is cut from demo-videos/raw/tablet-<a|b>.webm (repo root, git-ignored; override
with FOOTAGE_DIR) into assets/footage/<shot>.mp4: trimmed, played at the shot's speed, then frozen on its last frame
for the rest of its window; 30 fps H.264 with a short GOP so the renderer can seek. Do not edit index.html by hand.
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

def slot(shot):
    """Seconds a shot plays on screen: the slice at its speed plus the hold on its last frame."""
    parts = shot['duo'] if 'duo' in shot else [shot]
    return max((p['to'] - p['from']) / shot['speed'] for p in parts) + shot.get('hold', 0)


def plan():
    """Absolute times for the hook, every question card, beat, shot, caption and the end card."""
    x, card = B['xfade'], B['card']['dur']
    t = B['hook']['dur']
    beats = []
    for i, b in enumerate(B['beats']):
        c0 = t
        f0 = c0 + card
        shots, k = [], f0
        for j, s in enumerate(b['shots']):
            d = slot(s)
            sid = f'{b["id"]}-{j + 1}'
            shots.append(dict(s, id=sid, start=round(k, 3), play=round(d, 3),
                              keys=[[round(k + a, 3), v] for a, v in s.get('keys', [[0, [0, 0, TABLET_W]]])],
                              spots=[[round(k + sp[0], 3), round(k + sp[1], 3)] + sp[2:] for sp in s.get('spots', [])]))
            k += d
        f1 = k
        beats.append(dict(b, n=i + 1, card=[round(c0, 3), round(f0 + x, 3)], foot=[round(f0, 3), round(f1, 3)],
                          steps=[[round(f0 + a, 3), txt] for a, txt in b['steps']],
                          stamp=[round(f0 + b['stamp'][0], 3), b['stamp'][1]] if b.get('stamp') else None,
                          shots=shots))
        t = f1
    end0 = t
    total = round(end0 + B['end']['dur'], 3)
    # Every shot stays until the next one has faded in over it; the last shot of a beat stays until the
    # next question card (or the end card) fully covers the tablet.
    for i, b in enumerate(beats):
        cover = (beats[i + 1]['card'][0] if i + 1 < len(beats) else end0) + 0.8
        for j, s in enumerate(b['shots']):
            s['end'] = round(b['shots'][j + 1]['start'] + 0.3 if j + 1 < len(b['shots']) else cover, 3)
        b['copy'] = [round(b['foot'][0] - 0.2, 3), round(cover, 3)]
    return {'fps': B['fps'], 'xfade': x, 'hook': [0, round(B['hook']['dur'] + x, 3)], 'end': [round(end0, 3), total],
            'total': total, 'beats': beats}


# ---------- footage ----------

def cut(src, dst, start, length, speed, window):
    """Write `window` seconds: the source slice at `speed`, then a freeze of its last frame."""
    played = length / speed
    pad = max(0.0, window - played) + 0.5
    vf = (f'setpts=(PTS-STARTPTS)/{speed:.4f},fps={B["fps"]},scale={TABLET_W}:{TABLET_H}:flags=lanczos,'
          f'tpad=stop_mode=clone:stop_duration={pad:.3f}')
    key = hashlib.sha1(f'{src.stat().st_mtime}-{start}-{length}-{window}-{vf}'.encode()).hexdigest()[:12]
    stamp = dst.with_suffix('.key')
    if dst.exists() and stamp.exists() and stamp.read_text() == key:
        return
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', str(src),
                    '-vf', vf, '-t', f'{window:.3f}', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
                    '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(dst)], check=True)
    stamp.write_text(key)


def build_footage(p):
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is required to cut the footage (brew install ffmpeg)')
    OUT.mkdir(parents=True, exist_ok=True)
    for b in p['beats']:
        for s in b['shots']:
            parts = s['duo'] if 'duo' in s else [s]
            s['srcs'] = []
            for n, part in enumerate(parts):
                src = RAW / f'tablet-{part["tablet"]}.webm'
                if not src.exists():
                    sys.exit(f'Missing footage {src}. Copy the demo recording to demo-videos/raw/ or set FOOTAGE_DIR.')
                name = f'{s["id"]}{"-" + "ab"[n] if "duo" in s else ""}.mp4'
                cut(src, OUT / name, part['from'], part['to'] - part['from'], s['speed'], s['end'] - s['start'])
                s['srcs'].append(f'assets/footage/{name}')
            print(f'Footage: {s["id"]} {s["play"]:.1f}s on screen at x{s["speed"]} '
                  f'({", ".join(f"{q["tablet"].upper()} {q["from"]}-{q["to"]}" for q in parts)})')


# ---------- HTML pieces ----------

def win(start, end):
    return f'data-start="{start:.3f}" data-duration="{end - start:.3f}"'


def box_style(b):
    return f'--x:{b[0]};--y:{b[1]};--w:{b[2]};--h:{b[3]}'


def cards(p):
    return '\n      '.join(
        f'<section id="card-{b["id"]}" class="scene qcard clip" {win(*b["card"])} data-track-index="{3 + b["n"] % 2}">'
        f'<div class="scene-content"><span class="count"><b>{b["n"]:02d}</b> / {len(p["beats"]):02d}</span>'
        f'<h2>{html.escape(b["question"])}</h2></div></section>'
        for b in p['beats'])


def copies(p):
    out = []
    for b in p['beats']:
        steps = ''.join(f'<li class="step" id="step-{b["id"]}-{i}"><i></i><span>{html.escape(txt)}</span></li>'
                        for i, (_, txt) in enumerate(b['steps']))
        dots = ''.join(f'<i id="dot-{b["id"]}-{i}"></i>' for i in range(len(b['steps'])))
        out.append(
            f'<div id="copy-{b["id"]}" class="copy clip" {win(*b["copy"])} data-track-index="{10 + b["n"] % 2}" '
            f'style="z-index:{10 + b["n"]}"><div class="copy-in">'
            f'<span class="ask">{html.escape(b["question"])}</span>'
            f'<h2>{html.escape(b["title"])}</h2><ul class="steps">{steps}</ul>'
            f'<div class="dots">{dots}</div></div></div>')
    return '\n        '.join(out)


def spots_html(spots, strip=None):
    out = ''
    for i, sp in enumerate(spots):
        if strip is not None and sp[2] != strip:
            continue
        box = sp[-1]
        out += f'<i class="spot" data-i="{i}" style="{box_style(box)}"></i>'
    return out


def shots(p):
    out, k = [], 0
    for b in p['beats']:
        for s in b['shots']:
            k += 1
            if 'duo' in s:
                strips = ''.join(
                    f'<div class="strip"><div class="cam"><video id="v-{s["id"]}-{"ab"[n]}" class="clip" src="{src}" '
                    f'{win(s["start"], s["end"])} data-media-start="0" data-track-index="{30 + n}" muted playsinline></video>'
                    f'{spots_html(s["spots"], n)}</div><span class="who">{TABLETS[part["tablet"]]}</span></div>'
                    for n, (part, src) in enumerate(zip(s['duo'], s['srcs'])))
                out.append(f'<div id="shot-{s["id"]}" class="shot duo" style="z-index:{k}">{strips}</div>')
                continue
            out.append(
                f'<div id="shot-{s["id"]}" class="shot" style="z-index:{k}">'
                f'<div class="cam"><video id="v-{s["id"]}" class="clip" src="{s["srcs"][0]}" {win(s["start"], s["end"])} '
                f'data-media-start="0" data-track-index="{20 + k % 2}" muted playsinline></video>{spots_html(s["spots"])}</div></div>')
    return '\n          '.join(out)


def stamps(p):
    return ''.join(f'<div class="stamp" id="stamp-{b["id"]}">{html.escape(b["stamp"][1])}</div>'
                   for b in p['beats'] if b['stamp'])


def main():
    fmt = sys.argv[1] if len(sys.argv) > 1 else '16x9'
    if fmt not in FORMATS:
        sys.exit(f'usage: build.py {"|".join(FORMATS)}')
    f = FORMATS[fmt]
    p = plan()
    build_footage(p)
    tagline = ' '.join(f'<span class="w">{w}</span>' for w in TAGLINE.split())
    timing = json.loads(json.dumps(dict(p, screen=[f['screen'], round(f['screen'] * TABLET_H / TABLET_W, 3)],
                                        scale=f['screen'] / TABLET_W, format=fmt)))
    for b in timing['beats']:
        for s in b['shots']:
            s.pop('srcs', None)
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
        '@@CARDS@@': cards(p),
        '@@COPIES@@': copies(p),
        '@@SHOTS@@': shots(p),
        '@@STAMPS@@': stamps(p),
    }
    out = (ROOT / 'src' / 'index.tpl').read_text()
    for k, v in reps.items():
        out = out.replace(k, v)
    out = out.replace('@@MOTION@@', (ROOT / 'src' / 'motion.js').read_text().replace(
        '__TIMING__', json.dumps(timing, ensure_ascii=False)))
    if '@@' in out:
        sys.exit('Unreplaced markers in index.tpl')
    (ROOT / 'index.html').write_text(out)
    shots_n = sum(len(b['shots']) for b in p['beats'])
    print(f'index.html ready · {fmt} {f["w"]}x{f["h"]} · {len(p["beats"])} beats · {shots_n} shots · {p["total"]} s')


if __name__ == '__main__':
    main()
