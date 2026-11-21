# Música

Por ahora el video sale **sin audio**: no usamos servicios de pago ni pistas con licencia dudosa.

Si se agrega música después:

- Pista instrumental con licencia libre para uso comercial (por ejemplo, de la biblioteca de audio de YouTube o con licencia CC0), guardada en `assets/audio/` y fuera de git si pesa mucho.
- Tempo de 100 a 120 BPM: los cortes de cámara caen cada 2 a 3 s (`src/beats.json`), así que un golpe por compás encaja.
- Agregarla como `<audio>` aparte en `src/index.tpl` (`data-start="0"`, `data-duration` igual al total, `data-volume` alrededor de 0.6) y bajar el volumen 0.5 s antes del final con la salida del cierre.
- Volver a correr `npm run render` y `npm run qa` (el QA reporta la pista de audio si existe).
