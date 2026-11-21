# Estado: demo de 2 minutos

> Última actualización: 2026-11-21.

## Dónde quedó

- Historia de 120 s en cinco secciones (tiempos en `src/timing.json`):
  1. Problema (0-15 s): papel y Excel; "una mujer que viene 4 veces puede quedar registrada 4 veces"; sierra sin señal.
  2. La idea (15-25 s): logo, nombre, lema y "Hecho para EIRA Movimiento Rosa A.C.".
  3. Demo (25-100 s): dos tabletas lado a lado y ocho beats con título corto, explicación y estado de señal por tableta.
  4. Confianza (100-112 s): nunca une sola, cada quien ve lo suyo, nada clínico en avisos, Valkey + AWS + código abierto.
  5. Cierre (112-120 s): logo, lema, https://github.com/JoryerJL/huella-rosa y co-marca de EIRA.
- v1 renderizada con marcadores de lugar en las tabletas: `renders/huella-rosa-demo-v1.mp4` (fuera de git).
- Sin voz. Guion listo en `narration.md`.

## Beats del demo y tomas de la grabación

`timeline.json` de la grabación trae las tomas S1-S7. Cada beat toma una fracción (`slice`) de su toma; S7 se
reparte entre el médico y la bitácora. Si la grabación cambia, se ajusta `scene` y `slice` en `src/timing.json`.

| Beat | Inicio | Duración | Toma | Fracción | Señal A / B |
|---|---|---|---|---|---|
| Alta del personal y de la jornada | 25 s | 9 s | S1 | 0-1 | con / con |
| Cada tableta descarga su paquete | 34 s | 8 s | S2 | 0-1 | con / con |
| Sin señal, Lucía regresa y la reconoce | 42 s | 12 s | S3 | 0-1 | sin / sin |
| Recibe su folio del día | 54 s | 8 s | S4 | 0-1 | sin / sin |
| La siguiente estación la encuentra por folio | 62 s | 10 s | S5 | 0-1 | sin / sin |
| Vuelve la señal: todo llega una sola vez | 72 s | 11 s | S6 | 0-1 | con / con |
| El médico la atiende con señal | 83 s | 9 s | S7 | 0-0.6 | con / con |
| Todo queda en bitácora | 92 s | 8 s | S7 | 0.6-1 | con / con |

## Volver a renderizar con la grabación real

Cuando existan `demo-videos/raw/tablet-a.webm`, `demo-videos/raw/tablet-b.webm` y `demo-videos/raw/timeline.json`
en la raíz del repo, un solo comando:

```sh
VERSION=v2 npm run video:render    # desde la raíz del repo
# o, desde video/demo-2min/:  VERSION=v2 npm run render
VERSION=v2 npm run video:qa
```

`build.py` hace el resto:

- Lee `timeline.json` (acepta lista o mapa de tomas; tiempos en ms con `start`/`end`, `startMs`/`endMs` o
  `start_ms`/`end_ms`; si cada toma trae `a`/`b` o `tabletA`/`tabletB`, usa tiempos por tableta).
- Corta cada beat de cada tableta con ffmpeg a `assets/footage/<tableta>-<beat>.mp4` (1280x800, 30 fps,
  H.264 con keyframe cada 15 cuadros para que el render pueda buscar; el webm de MediaRecorder no trae índice).
- Si la toma dura más que el beat la acelera hasta 4x; si aun así no cabe, recorta el final. Si dura menos,
  congela el último cuadro. Imprime la velocidad usada por segmento.
- Una tableta o toma que falte conserva su marcador de lugar; el video se renderiza igual.
- Otra carpeta: `FOOTAGE_DIR=/ruta/raw VERSION=v2 npm run video:render`.

## Revisión (adaptada del repo modelo)

- `npm run check`: lint de HyperFrames (0 errores; los avisos `nested_structure_needs_subcomposition` y
  `timeline_track_too_dense` son de organización en Studio, no del render) y `check` (consola y contraste WCAG AA).
- `npm run qa`: decodificación completa, duración, 1920x1080, 30 fps, lenguaje sencillo en pantalla y stills de
  cada sección en `renders/stills/`. Loudness: no aplica hasta que haya voz.

## Activos

| Activo | Origen | Licencia |
|---|---|---|
| `assets/fonts/atkinson-hyperlegible-next-latin-wght.woff2` | Google Fonts (Atkinson Hyperlegible Next, variable, latin) | SIL Open Font License 1.1 |
| `assets/brand/fingerprint-b-mark.svg` (incrustado en `build.py`) | `docs/brand/logos/round2/` de este repo | Proyecto propio (MIT) |
| `assets/brand/eira-logo.jpeg` | `apps/web/public/brand/` de este repo | Marca de EIRA Movimiento Rosa A.C., co-marca del reto |
| `assets/vendor/gsap.min.js` | GSAP 3.14.2, copiado del repo modelo | Licencia estándar de GSAP (gratuita) |

Datos en pantalla: solo ficticios (nombres comunes combinados, "Loc. Demo N").

## Siguiente paso

1. Esperar la grabación de las tabletas y correr `VERSION=v2 npm run video:render`.
2. Ver el render completo y ajustar `slice` o duraciones de beats si alguna toma va muy rápida.
3. Grabar la voz con `narration.md` (sin servicios de pago) e integrarla.
