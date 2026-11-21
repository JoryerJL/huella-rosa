# Videos de Huella Rosa

Videos del producto hechos como código con [HyperFrames](https://github.com/heygen-com/hyperframes)
(HTML + GSAP -> MP4). Misma estructura que el repo de videos de producto que sirvió de modelo: un proyecto
HyperFrames por pieza en `video/<slug>/`, con su `ESTADO.md` (dónde quedó y qué falta) y `renders/` fuera de git.

| Slug | Qué es | Estado |
|---|---|---|
| `demo-2min` | Demo del producto, 2 min, 16:9 1920x1080, 30 fps, en español, sin voz (guion listo) | v1 renderizada con marcadores de lugar para las tabletas; ver `demo-2min/ESTADO.md` |
| `release` | Video de lanzamiento, 47 s, dos cortes del mismo guion: 16:9 1920x1080 y 9:16 1080x1920, 30 fps, sin voz ni música | v1 renderizada con la grabación real y zooms de cámara; ver `release/ESTADO.md` |
| `features` | Un video corto por función (16), 1920x1080, 30 fps, sin voz: tarjeta de título (3 s), la grabación en la tableta con una frase, cierre (2 s) | Ver "Videos por función" abajo |

## Videos por función (`features/`)

Usa las grabaciones de `npm run demo:features` (desde la raíz; deja los cortes en `demo-videos/features/clips/`, fuera de git) y los textos de `scripts/demo/features.json`, la misma lista que alimenta los GIF del `README.md`.

```sh
npm run demo:features                 # graba y genera GIF, imágenes fijas y cortes (desde la raíz)
cd video/features
python3 build.py 5                    # genera index.html para la función 5 (para npm run dev / check)
python3 render_all.py                 # renderiza todas a renders/NN-slug.mp4 (o: python3 render_all.py 5 12)
```

`index.html` se genera por función y no se versiona; `renders/` y `assets/footage/` tampoco.

## Requisitos

- Node 20+ (HyperFrames se usa con `npx`, versión fijada en cada `package.json`).
- Python 3.9+ (genera `index.html` desde `src/`).
- ffmpeg y ffprobe (cortar la grabación de las tabletas y revisar el render).

## Estructura de una pieza

```
video/<slug>/
  build.py          genera index.html desde src/ (no editar index.html a mano)
  src/index.tpl     marcado y estilos
  src/motion.js     línea de tiempo GSAP (solo entradas; la transición es la salida)
  src/timing.json   tiempos de secciones y beats (fuente única de tiempos)
  assets/           fuente, marca, GSAP local; footage/ se genera y no se versiona
  narration.md      guion de voz para después
  qa.py             revisión del MP4 (duración, resolución, fps, decodificación, lenguaje, stills)
  ESTADO.md         dónde quedó y qué sigue
  renders/          salida (fuera de git)
```

## Comandos (desde `video/<slug>/`)

```sh
npm run build    # genera index.html (usa la grabación si existe)
npm run dev      # preview en el navegador (HyperFrames Studio)
npm run check    # lint + check (contraste WCAG, errores de consola)
npm run render   # build + render a renders/huella-rosa-demo-v1.mp4
npm run qa       # revisa el MP4 y saca stills a renders/stills/
```

Desde la raíz del repo: `npm run video:render` y `npm run video:qa` (usan `VERSION`, por omisión `v1`); para el video de lanzamiento, `npm run video:release` y `npm run video:release:qa`.
