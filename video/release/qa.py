#!/usr/bin/env python3
"""QA for the rendered release cuts (same checks as video/demo-2min/qa.py).

Checks per cut: full decode, duration matches the plan, resolution, 30 fps, H.264 yuv420p, no audio expected
(see music.md), and the plain-language rule on the on-screen copy (src/index.tpl + src/beats.json).
Writes 6 stills per cut to renders/stills/<format>/.

Usage: python3 qa.py            # both cuts in renders/
       python3 qa.py 9x16       # one cut
"""
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

from build import FORMATS, ROOT, plan

# Words the product never shows on screen (CLAUDE.md, "Sin lenguaje de sistema en pantalla").
FORBIDDEN = ['servidor', 'sincroniz', 'versión', 'version', 'conflicto', 'duplicad', 'operación', 'id interno', 'huella sha']


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'title'):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'title'):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def stills(p):
    """Six hero frames: the camera landed on five proofs, then the end card."""
    beats = {b['id']: b for b in p['beats']}
    shot = lambda bid, j, d: beats[bid]['shots'][j]['start'] + d
    return {'1-antes-paquete-guardado': shot('antes', 1, 1.0), '2-busca-motivos': shot('busca', 1, 1.6),
            '3-sin-senal-folio': shot('senal', 2, 1.0), '4-vuelve-la-senal': shot('vuelve', 0, 4.5),
            '5-expediente-resultados': shot('proxima', 3, 4.9), '6-cierre': p['end'][0] + 4.0}


def copy_text():
    parser = Text()
    parser.feed((ROOT / 'src' / 'index.tpl').read_text())
    beats = json.loads((ROOT / 'src' / 'beats.json').read_text())['beats']
    words = parser.parts + ['Tableta de captura', 'Tableta de estaciones']
    for b in beats:
        words += [b['question'], b['title']] + [txt for _, txt in b['steps']] + ([b['stamp'][1]] if b.get('stamp') else [])
    return ' '.join(words).lower()


def check(fmt, p):
    f = FORMATS[fmt]
    mp4 = ROOT / 'renders' / f'huella-rosa-release-{fmt}.mp4'
    errors = []
    if not mp4.exists():
        return [f'{mp4.name} missing (npm run render:{fmt})']
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(mp4)],
                                      capture_output=True, text=True, check=True).stdout)
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    dur = float(probe['format']['duration'])
    num, den = (int(x) for x in v['r_frame_rate'].split('/'))
    fps = num / den
    print(f'[{fmt}] file: {mp4.relative_to(ROOT)} ({int(probe["format"]["size"]) / 1e6:.1f} MB)')
    print(f'[{fmt}] video: {v["codec_name"]} {v["width"]}x{v["height"]} {v.get("pix_fmt")} {fps:.2f} fps · duration {dur:.2f} s')
    print(f'[{fmt}] audio: {"none (no music yet, see music.md)" if not audio else audio[0]["codec_name"]}')
    if (v['width'], v['height']) != (f['w'], f['h']):
        errors.append(f'{fmt}: resolution {v["width"]}x{v["height"]}')
    if v['codec_name'] != 'h264' or v.get('pix_fmt') != 'yuv420p':
        errors.append(f'{fmt}: not h264/yuv420p')
    if abs(fps - p['fps']) > 0.01:
        errors.append(f'{fmt}: fps {fps}')
    if abs(dur - p['total']) > 0.5:
        errors.append(f'{fmt}: duration {dur:.2f} differs from {p["total"]}')
    dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-f', 'null', '-'], capture_output=True, text=True)
    ok = dec.returncode == 0 and not dec.stderr.strip()
    print(f'[{fmt}] decode: {"ok" if ok else "ERRORS"}')
    if not ok:
        errors.append(f'{fmt}: full decode reported errors')
    out = ROOT / 'renders' / 'stills' / fmt
    out.mkdir(parents=True, exist_ok=True)
    for name, t in stills(p).items():
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{t:.2f}', '-i', str(mp4), '-frames:v', '1', str(out / f'{name}.png')],
                       check=True)
    print(f'[{fmt}] stills: 6 in {out.relative_to(ROOT)}')
    return errors


def main():
    fmts = sys.argv[1:] or list(FORMATS)
    p = plan()
    hits = [w for w in FORBIDDEN if re.search(re.escape(w), copy_text())]
    print(f'plain language: {"ok" if not hits else "FORBIDDEN " + ", ".join(hits)}')
    errors = ['forbidden words on screen'] if hits else []
    for fmt in fmts:
        errors += check(fmt, p)
    if errors:
        print('QA FAILED: ' + '; '.join(errors))
        sys.exit(1)
    print('QA OK')


if __name__ == '__main__':
    main()
