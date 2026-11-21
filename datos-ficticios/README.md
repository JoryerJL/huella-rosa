# Datos ficticios

Todo lo que hay en esta carpeta es inventado. **Está prohibido usar datos reales de pacientes** (regla del hackathon y de EIRA).

## Qué crea `npm run seed`

- **Usuarios de demostración**, uno por rol: captura (`intake`), consulta clínica (`clinician`) y administración (`admin`).
- **Localidades** inventadas de un mismo municipio ficticio, varias marcadas sin señal (`hasSignal: false`).
- **Una jornada** con fecha, municipio y localidades, lista para descargar su paquete en el dispositivo de captura.
- **Unas 8 pacientes** con historial. Algunas ya tienen visitas y servicios de una jornada anterior, para demostrar la segunda visita con historial.
- **Al menos 2 casi duplicados a propósito**, para demostrar la búsqueda de coincidencias:
  - misma fecha de nacimiento y el nombre con y sin acento ("Lucía Demo Tres" y "Lucia Demo Tres");
  - misma fecha de nacimiento y los apellidos invertidos ("Ana Demo Prueba" y "Ana Prueba Demo").
  - Opcional: una pareja con nombre parecido y fecha de nacimiento distinta, para mostrar que solo el nombre nunca basta.

## Formatos (`formatos/`)

- Imágenes de **formatos de revisión mamaria llenados con datos ficticios** (foto o escaneo).
- `formatos/*.json`: la lectura esperada de cada imagen, con valor y confianza por campo según `plantillas/mamaria.json`. Lo usa `OCR_MODE=mock` para que el demo no dependa de la red.
- Al menos un formato corresponde a una paciente ya registrada (para mostrar "Es ella") y otro a una paciente nueva. Al menos un campo trae confianza baja para mostrar el marcado en amarillo.
- Las secciones manuscritas (18, 20, 21 y Notas) no se transcriben en el JSON: solo se conserva la imagen.

## Convenciones

- Nombres claramente falsos (por ejemplo "Paciente Demo Uno").
- Teléfonos 55-0000-00XX.
- Localidades inventadas ("San Ejemplo de la Sierra").
- ID del formato (campo 4, 11 casillas) con prefijo de prueba, por ejemplo `DEMO0000001`.

Los formatos en blanco de EIRA no se incluyen en este repo público; su publicación le corresponde a EIRA.
