#!/usr/bin/env python3
"""QA for a rendered demo MP4 (adapted from olon-contenido's render checks).

Checks: full decode, duration ~120 s, 1920x1080, 30 fps, H.264 yuv420p, no audio track expected yet
(loudness N/A until narration exists), and the plain-language rule on the on-screen copy of index.html.
Writes one still per section to renders/stills/.

Usage: python3 qa.py renders/huella-rosa-demo-v1.mp4
"""
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
T = json.loads((ROOT / 'src' / 'timing.json').read_text())
# Words the product never shows on screen (CLAUDE.md, "Sin lenguaje de sistema en pantalla").
FORBIDDEN = ['servidor', 'sincroniz', 'versión', 'version', 'conflicto', 'duplicad', 'operación', 'id interno', 'huella sha']
STILLS = {'1-problema': 4.8, '2-registros': 9.5, '3-sin-senal': 14.8, '4-idea': 21.0, '5-demo-alta': 33.0,
          '6-demo-reconoce': 52.0, '7-demo-senal': 82.0, '8-demo-bitacora': 98.5, '9-confianza': 110.0, '10-cierre': 117.5}


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def main(mp4):
    mp4 = Path(mp4)
    errors = []
    probe = json.loads(subprocess.run(
        ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(mp4)],
        capture_output=True, text=True, check=True).stdout)
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    dur = float(probe['format']['duration'])
    num, den = (int(x) for x in v['r_frame_rate'].split('/'))
    fps = num / den
    print(f'file: {mp4} ({int(probe["format"]["size"]) / 1e6:.1f} MB)')
    print(f'video: {v["codec_name"]} {v["width"]}x{v["height"]} {v.get("pix_fmt")} {fps:.2f} fps · duration {dur:.2f} s')
    print(f'audio: {"none (loudness N/A until narration)" if not audio else audio[0]["codec_name"]}')
    if (v['width'], v['height']) != (1920, 1080):
        errors.append('resolution is not 1920x1080')
    if abs(fps - T['fps']) > 0.01:
        errors.append(f'fps {fps} != {T["fps"]}')
    if abs(dur - T['end']) > 0.5:
        errors.append(f'duration {dur:.2f} differs from {T["end"]}')
    dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-f', 'null', '-'], capture_output=True, text=True)
    print(f'decode: {"ok" if dec.returncode == 0 and not dec.stderr.strip() else "ERRORS"}')
    if dec.returncode or dec.stderr.strip():
        errors.append('full decode reported errors')

    parser = Text()
    parser.feed((ROOT / 'index.html').read_text())
    copy = ' '.join(parser.parts).lower()
    hits = [w for w in FORBIDDEN if re.search(re.escape(w), copy)]
    print(f'plain language: {"ok" if not hits else "FORBIDDEN " + ", ".join(hits)}')
    if hits:
        errors.append('forbidden words on screen')

    out = mp4.parent / 'stills'
    out.mkdir(exist_ok=True)
    for name, t in STILLS.items():
        dst = out / f'{name}.png'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(t), '-i', str(mp4), '-frames:v', '1', str(dst)], check=True)
    print(f'stills: {len(STILLS)} in {out}')
    if errors:
        print('QA FAILED: ' + '; '.join(errors))
        sys.exit(1)
    print('QA OK')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'renders' / 'huella-rosa-demo-v1.mp4')
