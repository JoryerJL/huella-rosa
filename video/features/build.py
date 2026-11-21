#!/usr/bin/env python3
"""Generate index.html (the HyperFrames composition) for ONE feature video.

Usage: python3 build.py <n>      (n = feature number in scripts/demo/features.json)

Footage: demo-videos/features/clips/NN-slug-a.mp4 / -b.mp4 (made by `npm run demo:features`). Each is copied
to assets/footage/ with a short hold on its last frame. Layout: one tablet mockup, or two side by side when the
feature was recorded on both tablets. Timing: 3 s title card, the clip, 2 s end card. Do not edit index.html.
"""
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
CLIPS = REPO / 'demo-videos' / 'features' / 'clips'
OUT = ROOT / 'assets' / 'footage'
META = json.loads((REPO / 'scripts' / 'demo' / 'features.json').read_text())
FPS = 30
XFADE = 0.5
TITLE = 3.0
END = 2.0
HOLD = 0.6  # seconds the last frame stays before the end card
# Tablet labels for the two-tablet features (left, right).
LABELS = {10: ('Tableta de captura', 'Tableta de estación'), 11: ('Vista de captura', 'Vista clínica')}

MARK = ('<svg viewBox="0 0 512 512" aria-hidden="true"><rect x="52" y="52" width="408" height="408" rx="82" fill="#B7426C"/>'
        '<g transform="translate(0 4)" fill="none" stroke="#FFF8F5" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M115 257c0-119 83-181 141-181s141 62 141 181c0 91-38 150-92 179"/>'
        '<path d="M142 257c0-99 65-151 114-151s114 52 114 151c0 75-30 123-73 151"/>'
        '<path d="M169 257c0-77 47-119 87-119s87 42 87 119c0 58-23 96-56 119"/>'
        '<path d="M197 257c0-55 30-86 59-86s59 31 59 86c0 42-16 69-39 86"/>'
        '<path d="M224 257c0-31 15-49 32-49s32 18 32 49c0 24-9 39-22 49"/>'
        '<path d="M256 237c12 0 20 10 20 23 0 12-8 22-20 32-12-10-20-20-20-32 0-13 8-23 20-23z"/></g></svg>')


def probe_duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def hold_copy(src, dst):
    """Copy the clip with its last frame held for HOLD seconds (keyframes every 0.5 s for seeking)."""
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(src), '-vf', f'tpad=stop_mode=clone:stop_duration={HOLD + XFADE}',
                    '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart', str(dst)],
                   check=True)


def win(start, end):
    return f'data-start="{start:.3f}" data-duration="{end - start:.3f}"'


def layout(sides):
    """CSS for the tablet frames and screens; one tablet centered, or two side by side."""
    if len(sides) == 1:
        sw, sh, top = 1216, 760, 236
        lefts = [(1920 - (sw + 56)) // 2]
    else:
        sw, sh, top = 860, 538, 290
        lefts = [24, 1920 - 24 - (sw + 56)]
    css = []
    for i, left in enumerate(lefts):
        css.append(f'#tab-{i} {{ left: {left}px; top: {top}px; width: {sw + 56}px; height: {sh + 56}px; }}')
        css.append(f'#scr-{i} {{ left: {left + 28}px; top: {top + 28}px; width: {sw}px; height: {sh}px; }}')
        css.append(f'#lab-{i} {{ left: {left + 8}px; top: {top - 46}px; }}')
    return '\n      '.join(css)


def main():
    if len(sys.argv) != 2:
        sys.exit('usage: python3 build.py <feature number>')
    n = int(sys.argv[1])
    f = next((x for x in META['features'] if x['n'] == n), None)
    if not f:
        sys.exit(f'feature {n} not in scripts/demo/features.json')
    name = f'{n:02d}-{f["slug"]}'
    sides = [s for s in ('a', 'b') if (CLIPS / f'{name}-{s}.mp4').exists()]
    if not sides:
        sys.exit(f'no clip for {name} in {CLIPS} (run npm run demo:features first)')

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.mp4'):
        old.unlink()
    clip_dur = max(probe_duration(CLIPS / f'{name}-{s}.mp4') for s in sides)
    demo0 = TITLE - XFADE
    video0 = demo0 + 0.6
    demo1 = video0 + clip_dur + HOLD
    close0 = demo1 - XFADE
    end = round(close0 + END, 3)

    tablets, screens = [], []
    labels = LABELS.get(n, ('', ''))
    for i, s in enumerate(sides):
        dst = OUT / f'{name}-{s}.mp4'
        hold_copy(CLIPS / f'{name}-{s}.mp4', dst)
        tablets.append(f'<div class="tablet" id="tab-{i}"><i></i></div>')
        if len(sides) > 1 and labels[i]:
            tablets.append(f'<div class="label" id="lab-{i}">{html.escape(labels[i])}</div>')
        screens.append(f'<div class="screen" id="scr-{i}"><video id="v-{s}" src="assets/footage/{dst.name}" {win(video0, demo1)} '
                       f'data-media-start="0" class="clip" data-track-index="{5 + i}" muted playsinline></video></div>')

    timing = {'xfade': XFADE, 'title': [0, TITLE], 'demo': [demo0, demo1], 'close': [close0, end], 'end': end}
    tpl = (ROOT / 'src' / 'index.tpl').read_text()
    motion = (ROOT / 'src' / 'motion.js').read_text().replace('__TIMING__', json.dumps(timing))
    group = META['groups'][f['group']]
    repl = {
        'TITLE': html.escape(f['title']), 'SENTENCE': html.escape(f['sentence']), 'CAPTION': html.escape(f['caption']),
        'GROUP': html.escape(group), 'NUM': f'{n:02d}', 'MARK': MARK, 'END': f'{end:.3f}',
        'W_title': win(0, TITLE), 'W_demo': win(demo0, demo1), 'W_close': win(close0, end),
        'LAYOUT': layout(sides), 'TABLETS': '\n        '.join(tablets), 'SCREENS': '\n      '.join(screens), 'MOTION': motion,
    }
    out = re.sub(r'@@(\w+)@@', lambda m: repl[m.group(1)], tpl)
    (ROOT / 'index.html').write_text(out)
    print(f'{name}: clip {clip_dur:.1f} s, tablets {"+".join(s.upper() for s in sides)}, total {end:.1f} s')


if __name__ == '__main__':
    main()
