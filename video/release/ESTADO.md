# Estado: video de lanzamiento

**v1 renderizada** (21 nov 2026). 47 s, 30 fps, sin audio. Dos cortes del mismo guion:

- `renders/huella-rosa-release-16x9.mp4`: 1920x1080.
- `renders/huella-rosa-release-9x16.mp4`: 1080x1920 (redes).

Tipo lanzamiento: no recorre todo el flujo, vende seis momentos con un zoom de cámara al elemento de la pantalla que lo prueba.

| # | Titular | Toma (tableta, segundos de la grabación) | Dónde entra la cámara |
|---|---|---|---|
| — | Una mujer. Un solo expediente. | — | La huella se dibuja |
| 01 | La reconoce aunque escriban sin acentos | A 84.9–86.8 | Tarjeta "Coincidencia fuerte" y sus motivos |
| 02 | Funciona sin señal | A 121.8–125.2 | "3 cambios por enviar · Sin señal" |
| 03 | El folio une las estaciones | A 89.4–90.8, B 115.2–116.9 | Folio E6-001-B grande; aviso "Esta visita aún no llega…" |
| 04 | Vuelve la señal: todo llega una sola vez | A 125.7–129.0, B 125.2–127.9 | "Se enviaron 3 cambios" y "Se enviaron 2 cambios" |
| 05 | Cada especialista, solo lo suyo | B 118.4–120.8 | "Campos de mi paso" con talla y peso |
| 06 | Nunca fusiona sola | A 172.0–174.6 | Bitácora: "Ana Hernández Ruiz reconoció que ya había venido antes" |
| — | Cierre | — | Huella Rosa, lema, EIRA, huella-rosa.jjjl.dev |

## Cómo se hace

```sh
# la grabación (fuera de git) en demo-videos/raw/ de la raíz: tablet-a.webm, tablet-b.webm, timeline.json
npm run render        # corta las tomas, genera index.html y renderiza los dos cortes
npm run qa            # duración, resolución, fps, decodificación, lenguaje sencillo y 6 fotos por corte
FORMAT=9x16 npm run dev   # vista previa de un corte
```

Todo el guion (titulares, tomas, caja de enfoque y zoom) vive en `src/beats.json`; `build.py` corta las tomas y arma `index.html`.

## Qué falta

- "Del papel al expediente" (foto del formato con campos en ámbar): se saltó porque no hay grabación de esa pantalla todavía. Cuando exista, agregar un beat en `src/beats.json` con su toma.
- "¿Es la misma persona?" de administración: no está grabado; el beat 06 usa la frase de la bitácora.
- Música: ver `music.md`.

## Modelos que se reusaron

- `SisInventario/videos/release/reel-2026-11`: tomas cortas cortadas por script desde la grabación, entrada con barrido y empuje lento de cámara.
- `video/demo-2min` (este repo): marca, fuente, GSAP local, `build.py` que genera `index.html`, y `qa.py`.
- `olon-contenido/videos/app-admin-lanzamiento`: estructura de proyecto con `ESTADO.md` y renders fuera de git.
