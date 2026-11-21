# Guion de voz (pendiente de grabar)

La v1 no lleva voz: los textos en pantalla cuentan la historia. Este guion queda listo para grabar después
(voz propia o TTS gratuito; sin servicios de pago). Ritmo objetivo: 140 a 150 palabras por minuto, con
silencios donde la pantalla habla sola. Los tiempos coinciden con `src/timing.json`.

Regla de lenguaje: igual que en pantalla, nunca decir "servidor", "sincronizar", "versión", "conflicto" ni
"duplicado". Decir qué pasa, con personas.

| Tiempo | Sección | Voz |
|---|---|---|
| 0:00-0:05 | Problema | En cada jornada, EIRA llena formatos en papel. Esa misma noche, alguien los vuelve a capturar en Excel. |
| 0:05-0:11 | Problema | La paciente se identifica por su nombre. Si viene cuatro veces, puede quedar registrada cuatro veces, y su historial se parte. |
| 0:11-0:15 | Problema | Y en la sierra no hay señal. |
| 0:15-0:25 | La idea | Huella Rosa: una mujer, una huella, un solo expediente, con o sin señal. Hecho para EIRA Movimiento Rosa. |
| 0:25-0:34 | Demo 1 | Administración da de alta al personal y abre la jornada. |
| 0:34-0:42 | Demo 2 | Antes de salir, cada tableta descarga su paquete: pacientes, localidades y formatos. |
| 0:42-0:54 | Demo 3 | Ya sin señal, llega Lucía. Escribimos su nombre sin acentos y la app la reconoce: misma fecha de nacimiento, nombre parecido. La app propone; una persona confirma. |
| 0:54-1:02 | Demo 4 | Lucía recibe su folio del día. |
| 1:02-1:12 | Demo 5 | En la siguiente estación, otra tableta la encuentra por folio, también sin señal. |
| 1:12-1:23 | Demo 6 | Vuelve la señal. Las dos tabletas envían lo que capturaron y todo llega una sola vez: un solo expediente. |
| 1:23-1:32 | Demo 7 | El médico, ya con señal, ve su historial completo. |
| 1:32-1:40 | Demo 8 | Y todo queda en bitácora: quién, qué, cuándo y desde qué tableta. |
| 1:40-1:52 | Confianza | Huella Rosa nunca une expedientes por su cuenta. Cada quien ve solo lo que le toca, y los avisos no llevan datos clínicos. Con Valkey, AWS y código abierto. |
| 1:52-2:00 | Cierre | Huella Rosa. Una mujer, una huella, un solo expediente. Hecho para EIRA Movimiento Rosa. |

## Cómo integrarla

1. Grabar `assets/audio/voz.wav` (o una pista por sección) y anotar fuente y licencia en `ESTADO.md`.
2. Agregar en `src/index.tpl`, dentro de `#root`, un `<audio id="vo" src="assets/audio/voz.wav" data-start="0"
   data-duration="120" data-track-index="30" data-volume="1"></audio>` (video siempre mudo, audio aparte).
3. Ajustar tiempos en `src/timing.json` si la voz lo pide, `npm run render` y medir loudness (meta -16 LUFS,
   pico menor a -1 dBTP) como en `olon-contenido/docs/produccion-reels.md`.
