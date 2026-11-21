# Estado: video de lanzamiento

**v2 renderizada** (21 nov 2026). 72.8 s, 30 fps, sin audio. Dos cortes del mismo guion:

- `renders/huella-rosa-release-16x9.mp4`: 1920x1080.
- `renders/huella-rosa-release-9x16.mp4`: 1080x1920 (redes).

v2 responde a "falta mostrar cómo se busca… muestras a medias": cada beat abre con una pregunta en pantalla y luego
**muestra la acción completa** con la grabación real (se ve escribir, el cursor y la pantalla que cambia), acelerada
o más lenta según haga falta. La cámara sigue la acción con paradas (`keys`) elegidas para que ningún título quede
cortado, y un recuadro rosa con el resto atenuado marca el elemento en foco. Abajo del titular, un subtítulo dice el
paso que está pasando.

| # | Pregunta | Qué se ve (tableta, segundos de la grabación) |
|---|---|---|
| — | Una mujer. Un solo expediente. | La huella se dibuja |
| 01 | ¿Y antes de salir a la comunidad? | A 59.2–64.2: elige la jornada, "Descargar paquete", queda guardado y la barra muestra la jornada |
| 02 | Así se busca a una paciente | A 76.0–87.2: escribe "Lucia Ramirez Torres" sin acentos, fecha, teléfono, Buscar, "Coincidencia fuerte" con motivos, "Es ella" |
| 03 | ¿Y si no hay señal? | A 74.0–76.0 la barra cambia a "Sin señal"; A 87.0–90.9 registra la visita, "Guardado ✓", folio E6-001-B, "1 cambio por enviar" |
| 04 | ¿Y las otras estaciones? | B 113.6–123.0: Nutrición teclea el folio, aviso "Esta visita aún no llega…", llena talla/peso/PA, guarda |
| 05 | ¿Y cuando vuelve la señal? | A 124.6–129.0 y B 123.6–127.8 una sobre otra: "Se enviaron 3 cambios" / "Se enviaron 2 cambios"; sello "Un solo expediente, sin repetir" |
| 06 | ¿Y la próxima vez? | B 141.0–152.4: el médico busca, abre el expediente (nombre, ID EIRA, 2 visitas), la cámara recorre identificación, visita de hoy con jornada y folio, estaciones hechas, resultados por estación, visita de mayo; A 172.0–174.6 bitácora |
| — | Cierre | Huella Rosa, lema, EIRA, huella-rosa.jjjl.dev |

## Cómo se hace

```sh
# la grabación (fuera de git) en demo-videos/raw/ de la raíz: tablet-a.webm, tablet-b.webm, timeline.json
npm run render        # corta las tomas, genera index.html y renderiza los dos cortes
npm run qa            # duración, resolución, fps, decodificación, lenguaje sencillo y 6 fotos por corte
FORMAT=9x16 npm run dev   # vista previa de un corte
```

Todo el guion (preguntas, subtítulos, tomas, velocidad, paradas de cámara y recuadros) vive en `src/beats.json`;
`build.py` corta las tomas y arma `index.html`.

## Qué falta o está limitado

- **Paquete de jornada**: la grabación no baja hasta el resumen (pacientes en la tableta, "Vence · en 7 días"), así que
  el video muestra la descarga y lo dice en el subtítulo ("Sirve 7 días sin señal", sin resultados clínicos), verificado en
  el código (`PACKAGE_VALID_DAYS = 7`, `package.privacy`). No se inventa el número de pacientes. Para mostrarlo, la próxima
  grabación debe bajar hasta ese resumen.
- "Del papel al expediente" (foto del formato) y "¿Es la misma persona?" de administración: no están grabados.
- Música: ver `music.md`.

## Modelos que se reusaron

- `SisInventario/videos/release/reel-2026-11`: tomas cortas cortadas por script desde la grabación, barridos y empuje de cámara.
- `video/demo-2min` (este repo): marca, fuente, GSAP local, `build.py` que genera `index.html`, y `qa.py`.
- `olon-contenido/videos/app-admin-lanzamiento`: estructura de proyecto con `ESTADO.md` y renders fuera de git.
