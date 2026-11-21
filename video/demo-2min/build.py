#!/usr/bin/env python3
"""Generate index.html (the HyperFrames composition) from src/index.tpl, src/motion.js and src/timing.json.

Footage: if demo-videos/raw/ (repo root) holds tablet-a.webm, tablet-b.webm and timeline.json, each demo
beat gets one MP4 segment per tablet in assets/footage/ (trimmed to its scene slice, sped up to fit the beat,
re-encoded with frequent keyframes so the renderer can seek). A tablet without footage keeps its placeholder
(drawn at the real tablet size, 1280x800, and scaled into the frame). Do not edit index.html by hand.

Override the footage folder with FOOTAGE_DIR=/path/to/raw.
"""
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
RAW = Path(os.environ.get('FOOTAGE_DIR', REPO / 'demo-videos' / 'raw'))
OUT = ROOT / 'assets' / 'footage'
T = json.loads((ROOT / 'src' / 'timing.json').read_text())
MAX_SPEED = 4.0  # beyond this the slice is trimmed instead of sped up further
TABLET_W, TABLET_H = 1280, 800
SIDES = ('a', 'b')

MARK = ('<svg viewBox="0 0 512 512" aria-hidden="true"><rect x="52" y="52" width="408" height="408" rx="82" fill="#B7426C"/>'
        '<g transform="translate(0 4)" fill="none" stroke="#FFF8F5" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">'
        '<path pathLength="1" d="M115 257c0-119 83-181 141-181s141 62 141 181c0 91-38 150-92 179"/>'
        '<path pathLength="1" d="M142 257c0-99 65-151 114-151s114 52 114 151c0 75-30 123-73 151"/>'
        '<path pathLength="1" d="M169 257c0-77 47-119 87-119s87 42 87 119c0 58-23 96-56 119"/>'
        '<path pathLength="1" d="M197 257c0-55 30-86 59-86s59 31 59 86c0 42-16 69-39 86"/>'
        '<path pathLength="1" d="M224 257c0-31 15-49 32-49s32 18 32 49c0 24-9 39-22 49"/>'
        '<path pathLength="1" d="M256 237c12 0 20 10 20 23 0 12-8 22-20 32-12-10-20-20-20-32 0-13 8-23 20-23z"/></g></svg>')
TAGLINE = 'Una mujer, una huella, un solo expediente, con o sin señal.'
SIGNAL = {'online': 'Con señal', 'offline': 'Sin señal'}


# ---------- timeline.json (tolerant: the recorder's exact shape may vary) ----------

def _secs(entry, kind):
    """Read start/end from an entry. Keys ending in ms are milliseconds; plain start/end are ms too (per brief)."""
    for key in (f'{kind}Ms', f'{kind}_ms', kind, f'{kind}S', f'{kind}_s'):
        if key in entry:
            v = float(entry[key])
            return v if key.endswith(('S', '_s')) else v / 1000.0
    raise KeyError(f'missing {kind} in {entry}')


def parse_timeline(data):
    """Return {scene_id: {'a': (start, end), 'b': (start, end)}} in seconds."""
    scenes = data.get('scenes', data) if isinstance(data, dict) else data
    if isinstance(scenes, dict):
        scenes = [dict(v, id=k) for k, v in scenes.items() if isinstance(v, dict)]
    out = {}
    for s in scenes:
        sid = str(s.get('id') or s.get('scene') or s.get('name'))
        per = {}
        for side in SIDES:
            sub = s.get(side) or s.get(f'tablet{side.upper()}') or (s.get('tablets') or {}).get(side)
            src = sub if isinstance(sub, dict) else s
            per[side] = (_secs(src, 'start'), _secs(src, 'end'))
        out[sid] = per
    return out


# ---------- footage segments ----------

def probe_duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def cut_segment(src, dst, start, length, slot):
    """Trim [start, start+length] from src, fit it into `slot` seconds and write a seekable MP4."""
    speed = max(1.0, min(MAX_SPEED, length / slot))
    used = min(length, slot * speed)
    pad = max(0.0, slot - used / speed) + 0.5
    vf = (f'setpts=PTS/{speed:.4f},fps={T["fps"]},'
          f'scale={TABLET_W}:{TABLET_H}:force_original_aspect_ratio=decrease,'
          f'pad={TABLET_W}:{TABLET_H}:(ow-iw)/2:(oh-ih)/2:color=0xFFF8F5,'
          f'tpad=stop_mode=clone:stop_duration={pad:.3f}')
    key = hashlib.sha1(f'{src.stat().st_mtime}-{start}-{used}-{slot}-{vf}'.encode()).hexdigest()[:12]
    stamp = dst.with_suffix('.key')
    if dst.exists() and stamp.exists() and stamp.read_text() == key:
        return speed, used < length
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{used:.3f}', '-i', str(src),
           '-vf', vf, '-t', f'{slot:.3f}', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
           '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart', str(dst)]
    subprocess.run(cmd, check=True)
    stamp.write_text(key)
    return speed, used < length


def build_footage():
    """Return {(side, beat_id): relative mp4 path} for every beat with real footage."""
    timeline_path = RAW / 'timeline.json'
    if not timeline_path.exists():
        print(f'Footage: no {timeline_path.relative_to(REPO) if RAW.is_relative_to(REPO) else timeline_path}; placeholders only')
        return {}
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is required to cut the footage (brew install ffmpeg)')
    scenes = parse_timeline(json.loads(timeline_path.read_text()))
    OUT.mkdir(parents=True, exist_ok=True)
    found = {}
    for side in SIDES:
        src = RAW / f'tablet-{side}.webm'
        if not src.exists():
            print(f'Footage: {src.name} missing; tablet {side.upper()} keeps placeholders')
            continue
        total = probe_duration(src)
        for b in T['beats']:
            if b['scene'] not in scenes:
                print(f'Footage: scene {b["scene"]} not in timeline.json; {b["id"]}/{side} keeps placeholder')
                continue
            s0, s1 = scenes[b['scene']][side]
            if total:
                s1 = min(s1, total)
            f0, f1 = b.get('slice', [0, 1])
            start, end = s0 + (s1 - s0) * f0, s0 + (s1 - s0) * f1
            if end - start < 0.2:
                print(f'Footage: {b["id"]}/{side} slice too short; keeps placeholder')
                continue
            dst = OUT / f'{side}-{b["id"]}.mp4'
            speed, trimmed = cut_segment(src, dst, start, end - start, b['dur'] + T['xfade'])
            note = ' (trimmed)' if trimmed else ''
            print(f'Footage: {dst.name} {end - start:.1f}s -> {b["dur"]:.1f}s at {speed:.2f}x{note}')
            found[(side, b['id'])] = f'assets/footage/{dst.name}'
    return found


# ---------- HTML pieces ----------

def win(start, end):
    return f'data-start="{start:.3f}" data-duration="{end - start:.3f}"'


def beat_window(i, b):
    """A beat stays until the next one has finished fading in over it."""
    last = i == len(T['beats']) - 1
    end = T['sections']['demo'][1] if last else b['start'] + b['dur'] + T['xfade']
    return b['start'], end


def heads():
    n = len(T['beats'])
    out = []
    for i, b in enumerate(T['beats']):
        s, e = beat_window(i, b)
        segs = ''.join(f'<i class="{"done" if j < i else "now" if j == i else ""}"><b></b></i>' for j in range(n))
        tags = ''.join(
            f'<div class="tag {side}">Tableta {side.upper()}<span class="pill {b["signal"][side]}">{SIGNAL[b["signal"][side]]}</span></div>'
            for side in SIDES)
        out.append(
            f'<div id="head-{b["id"]}" class="beat-head clip" {win(s, e)} data-track-index="{10 + i % 2}">'
            f'<div class="top"><span class="kicker">Demo · {i + 1} de {n}</span><span class="progress">{segs}</span></div>'
            f'<h2>{html.escape(b["label"])}</h2><p>{html.escape(b["sub"])}</p>'
            f'<div class="tags">{tags}</div></div>')
    return '\n      '.join(out)


def placeholder(side, i, b, s, e, track):
    return (f'<div id="scr-{side}-{b["id"]}" class="ph clip" {win(s, e)} data-track-index="{track}">'
            f'<div class="appbar">Huella Rosa<span>{SIGNAL[b["signal"][side]]}</span></div>'
            f'<div class="body"><small>Tableta {side.upper()} · toma {b["scene"]}</small>'
            f'<strong>{html.escape(b["label"])}</strong>'
            f'<em>Aquí va la grabación de la tableta ({TABLET_W}×{TABLET_H}).</em></div></div>')


def screens(side, footage):
    base = {'a': 20, 'b': 24}[side]
    out = []
    for i, b in enumerate(T['beats']):
        s, e = beat_window(i, b)
        track = base + i % 2
        src = footage.get((side, b['id']))
        if src:
            out.append(f'<video id="scr-{side}-{b["id"]}" src="{src}" {win(s, e)} data-media-start="0" '
                       f'class="clip" data-track-index="{track}" muted playsinline></video>')
        else:
            out.append(placeholder(side, i, b, s, e, track))
    return '\n        '.join(out)


def main():
    footage = build_footage()
    tpl = (ROOT / 'src' / 'index.tpl').read_text()
    tagline = ' '.join(f'<span class="w">{w}</span>' for w in TAGLINE.split())
    reps = {
        '@@END@@': f'{T["end"]:.1f}',
        '@@MARK@@': MARK,
        '@@TAGLINE@@': tagline,
        '@@HEADS@@': heads(),
        '@@SCREENS_A@@': screens('a', footage),
        '@@SCREENS_B@@': screens('b', footage),
        '@@MOTION@@': (ROOT / 'src' / 'motion.js').read_text().replace('__TIMING__', json.dumps(T, ensure_ascii=False)),
    }
    for name, (s, e) in T['sections'].items():
        reps[f'@@W_{name}@@'] = win(s, e)
    out = tpl
    for k, v in reps.items():
        out = out.replace(k, v)
    left = re.findall(r'@@[A-Za-z0-9_]+@@', out)
    if left:
        sys.exit(f'Unreplaced markers: {left}')
    (ROOT / 'index.html').write_text(out)
    real = len(footage)
    print(f'index.html ready · {len(T["beats"])} beats · {real}/{2 * len(T["beats"])} screens with footage · end {T["end"]} s')


if __name__ == '__main__':
    main()
