# Pruebas de lectura de formatos (OCR) en producción

Fecha: 2026-11-21. Servidor: `https://huella-rosa.jjjl.dev` con `OCR_MODE=textract` (AWS Textract, `AnalyzeDocument` con `FORMS`). Usuaria: captura (`intake`).

## Qué se probó

8 fotos de formatos de revisión mamaria llenados a mano con datos ficticios (no están en el repo). Para cada foto:

1. Se sube con `POST /api/scans`, como lo hace "Identificar con foto".
2. Se comparan los 6 campos de identificación propuestos (`fullName`, `birthDate`, `birthState`, `formId`, `mobile`, `residence`) con los valores esperados. La comparación ignora mayúsculas, acentos y espacios; las fechas se comparan en `AAAA-MM-DD` y los teléfonos solo por dígitos. Un campo vacío en papel cuenta como correcto si la lectura también viene vacía.
3. Se corre la misma búsqueda que hace la app después de confirmar (`draftFromScan`): nombre + fecha de nacimiento + celular; si no hay celular, el ID; si no, la entidad.

Script: `scripts/ocr-eval/run.ts` (instrucciones al inicio del archivo; `npm run ocr:eval`).

Costo: dos pasadas contra Textract (antes y después de los cambios), 8 páginas cada una: 16 páginas, unos USD 0.80 (USD 0.05 por página con `FORMS`), dentro de la autorización previa. La simulación con fecha tecleada reutilizó las lecturas guardadas (`OCR_REPLAY`) y no llamó a Textract. Efecto en producción: quedaron 16 registros de formato (`FormScan`) en estado `READ`, sin visita, subidos por la usuaria de prueba, con sus imágenes.

## Antes y después

- **Antes**: primera pasada, mapeo original (etiqueta completa, confianza del par llave-valor).
- **Después**: segunda pasada sobre las mismas 8 fotos, con producción en `b40cebc` (cambios descritos en "Cambios aplicados").

Las dos columnas de detección son **solo con la foto**: nadie teclea nada.

| | Antes | Después |
|---|---|---|
| Fecha de nacimiento correcta | 0/8 | **7/8** (falla img-02, foto inclinada) |
| Campos correctos (6 por foto) | 39/48 (81 %) | **46/48 (96 %)** |
| Celular correcto | 7/8 | 7/8 (img-03 sigue sin leerse) |
| Nombre, entidad, ID, residencia | 8/8 cada uno | 8/8 cada uno |
| Pacientes existentes encontradas como coincidencia fuerte | 0/6 (sin fecha no hay búsqueda) | **5/6** (falta img-02: sin fecha no hay búsqueda) |
| Pacientes nuevas sin coincidencia fuerte | 2/2 (solo porque no hubo búsqueda) | 2/2 (búsqueda hecha, sin candidatas) |
| Detección correcta | 2/8 | **7/8** |
| Campos en amarillo | 0 | 3: el año tachado de img-08 (bien marcado) y 2 nombres correctos (falsas alarmas) |
| Valores mal leídos que quedaron sin amarillo | 1 celular vacío y 8 fechas vacías | 1 celular vacío (img-03) y 1 fecha vacía (img-02) |

### Segunda pasada: resultado por imagen

| Imagen | Variación | Campos correctos | En amarillo | Búsqueda con la foto sola | ¿Correcta? |
|---|---|---|---|---|---|
| img-01 | Letra de molde limpia | 6/6 | Nombre (0.67, valor correcto) | Fuerte, 75: fecha + nombre + teléfono | Sí |
| img-02 | Foto inclinada | 5/6 (fecha vacía) | ninguno | No se puede buscar: falta la fecha | **No** |
| img-03 | Nombre largo escrito con prisa | 5/6 (celular vacío) | Nombre (0.77, valor correcto) | Fuerte, 100: ID + fecha + nombre | Sí |
| img-04 | Sombra sobre la hoja | 6/6 | ninguno | Sin candidatas (paciente nueva) | Sí |
| img-05 | Letra cursiva | 6/6 | ninguno | Sin candidatas (paciente nueva) | Sí |
| img-06 | Sin acentos y casilla de ID vacía | 6/6 | ninguno | Fuerte, 75: fecha + nombre + teléfono, sin ID ni acentos | Sí |
| img-07 | Sin teléfono | 6/6 | ninguno | Fuerte, 100: ID + fecha + nombre | Sí |
| img-08 | Año tachado y corregido | 6/6 | Fecha (0.50: se detectó la corrección; propuso 1995, el año correcto) | Fuerte, 75: fecha + nombre + teléfono | Sí |

El guion sobrante del celular de img-04 ya no aparece (`55-0000-0040`).

### Qué falló en la segunda pasada

1. **Fecha de img-02 (foto inclinada).** La fecha quedó vacía con confianza 0: ni las llaves Día/Mes/Año ni las palabras del renglón se reconocieron en el mismo renglón que la etiqueta. En la foto, el renglón baja de izquierda a derecha (unos 7 px de 1672 entre "Fecha de nacimiento" y "Año"), y la regla de "mismo renglón" compara solo la altura del centro de cada caja. Es la causa más probable, pero no está confirmada: la API no devuelve los bloques crudos de Textract. Arreglo sugerido: medir la inclinación con el polígono de la línea de la etiqueta (`Geometry.Polygon`) y comparar cada caja contra la recta del renglón, no contra una franja horizontal.
2. **Celular de img-03 (escrito arriba de la línea).** La llave "Celular" sigue llegando sin valor y la búsqueda cercana no lo encontró. Causa probable: en estas fotos de prueba la "letra a mano" es una tipografía, y Textract la clasifica como impresa. Varios valores salieron con confianza 1.00, lo que no puede pasar con palabras marcadas como letra a mano (con el reescalado, el máximo es 0.89). La búsqueda cercana se detiene en la primera palabra impresa, que toma por la siguiente etiqueta. Arreglo sugerido: detenerse en la siguiente llave o en una palabra que coincida con una etiqueta de la plantilla, no en cualquier palabra impresa. Con letra a mano real, la regla actual podría funcionar; falta probarlo.

### Umbral de amarillo con datos reales por palabra

En la segunda pasada hubo 38 valores no vacíos; **todos fueron correctos**. En las dos pasadas (16 lecturas) no apareció ningún valor no vacío mal leído: los errores fueron siempre campos vacíos. Por eso los datos no permiten medir qué umbral atrapa errores; solo permiten medir las falsas alarmas.

| Umbral de amarillo (confianza mostrada) | Valores correctos marcados (falsas alarmas) de 37* |
|---|---|
| < 0.70 | 1 |
| **< 0.80 (actual)** | **2** |
| < 0.90 | 6 |

\* Sin contar la fecha de img-08, que se marca a propósito con 0.50 por la corrección visible.

Decisión: **se queda la línea de amarillo en 0.80 y el reescalado de letra a mano en 0.90**. Subirla a 0.90 triplica las falsas alarmas sin un solo error que atrapar en esta muestra. Bajarla no tiene respaldo, porque no sabemos qué confianza tiene una lectura equivocada. Las dos señales que sí funcionaron no dependen del umbral: la corrección visible (0.50) y, pendiente, marcar los campos de identificación vacíos.

## Primera pasada: resultado por imagen

"Detección (lectura sola)" es lo que pasa con lo que propone la lectura, sin que nadie escriba nada. "Detección (fecha tecleada)" es lo que pasa cuando la persona escribe la fecha de nacimiento que no se leyó (todo lo demás tal como lo leyó Textract).

| Imagen | Variación | Campos correctos | Campos en amarillo (< 0.80) | Detección (lectura sola) | Detección (fecha tecleada) | ¿Correcta? |
|---|---|---|---|---|---|---|
| img-01 | Letra de molde limpia | 5/6 (falla fecha) | ninguno | No se puede buscar: falta la fecha | Fuerte, 75: misma fecha + nombre parecido + mismo teléfono | Sí |
| img-02 | Foto inclinada | 5/6 (falla fecha) | ninguno | No se puede buscar | Fuerte, 75: fecha + nombre + teléfono | Sí |
| img-03 | Nombre largo escrito con prisa | 4/6 (fallan fecha y celular) | ninguno | No se puede buscar | Fuerte, 100: mismo ID + fecha + nombre (buscó por ID porque no leyó el celular) | Sí |
| img-04 | Sombra sobre la hoja | 5/6 (falla fecha) | ninguno | No se puede buscar | Sin candidatas (paciente nueva) | Sí |
| img-05 | Letra cursiva | 5/6 (falla fecha) | ninguno | No se puede buscar | Sin candidatas (paciente nueva) | Sí |
| img-06 | Sin acentos y casilla de ID vacía | 5/6 (falla fecha) | ninguno | No se puede buscar | Fuerte, 75: fecha + nombre + teléfono (sin ID y sin acentos) | Sí |
| img-07 | Sin teléfono | 5/6 (falla fecha) | ninguno | No se puede buscar | Fuerte, 100: mismo ID + fecha + nombre | Sí |
| img-08 | Año tachado y corregido | 5/6 (falla fecha) | ninguno | No se puede buscar | Fuerte, 75: fecha + nombre + teléfono | Sí, pero el año tachado no se puso a prueba (ver abajo) |

Detección con la lectura sola: 0 de 6 pacientes existentes encontradas (la búsqueda exige fecha de nacimiento). Las 2 nuevas (img-04 y img-05) no se confunden con nadie, pero solo porque no hubo búsqueda.

Detección con la fecha tecleada: **8/8**. Las 6 existentes salen como coincidencia fuerte con la persona correcta; las 2 nuevas no traen ninguna candidata.

## Primera pasada: precisión por campo

| Campo | Correctos | Notas |
|---|---|---|
| Nombre (`fullName`) | 8/8 | Exacto letra por letra en las 8, acentos incluidos, también con prisa y en cursiva. |
| Fecha de nacimiento (`birthDate`) | **0/8** | Siempre vacía con confianza 0. Es un problema de mapeo, no de lectura (ver abajo). |
| Entidad de nacimiento (`birthState`) | 8/8 | Exacto en las 8. |
| ID (`formId`) | 8/8 | Exacto en las 7 casillas llenas; en img-06 (casilla vacía) vino vacío, como debe. |
| Celular (`mobile`) | 7/8 | img-03: no se leyó. img-04: vino como `55-0000-0040 -` (guion de más; los dígitos son correctos). En img-07 (sin teléfono) vino vacío, como debe. |
| Residencia (`residence`) | 8/8 | Exacta en img-01 e img-06; vacía en las demás, como en el papel. |

Total: 39 de 48 campos correctos (81 %). Sin la fecha, 39 de 40 (97.5 %).

Confianza: todos los valores leídos quedaron entre 0.80 y 0.95, así que **ningún campo se marcó en amarillo** (el umbral es `< 0.80`). Tampoco se marcó el celular vacío de img-03, que venía con 0.90.

## Primera pasada: qué falló y por qué

### 1. Fecha de nacimiento: el mapeo de etiquetas no la reconoce (8/8)

En el papel, la fecha no es una sola casilla: dice `5. Fecha de nacimiento  Día __  Mes __  Año ____`. Textract la devuelve como tres pares llave-valor (`Día`, `Mes`, `Año`, con o sin el texto "5. Fecha de nacimiento" pegado a la primera llave). `mapTextractBlocks` (`apps/server/src/scans/textractMapping.ts`) solo acepta una llave cuyo texto normalizado sea igual a la etiqueta de la plantilla, `fecha de nacimiento`; ninguna de las tres llaves cumple, así que el campo se queda vacío con confianza 0 en todas las fotos. No es la letra: falla igual en la foto de letra de molde limpia (img-01), y la confianza 0 indica que ninguna llave coincidió, no una lectura dudosa.

Además, las etiquetas `Día`, `Mes` y `Año` se repiten en el mismo formato (1. Fecha de atención, 13. FUM, 16.1 Fecha de última mastografía), así que tampoco basta con mapear "Día" sin más.

Consecuencia: con la foto sola nunca se puede buscar. La persona tiene que escribir la fecha a mano en la pantalla de confirmación cada vez.

**Arreglo propuesto** (aplicado después; ver "Cambios aplicados"): en `mapTextractBlocks`, armar la fecha a partir de las tres partes que están en el mismo renglón que el texto "Fecha de nacimiento".

1. En `plantillas/mamaria.json`, declarar las partes del campo:

   ```json
   { "clave": "birthDate", "etiqueta": "5. Fecha de nacimiento", "tipo": "fecha", "partes": ["Día", "Mes", "Año"], ... }
   ```

2. En `textractMapping.ts`, para cada campo con `partes`:
   - Ubicar el bloque `LINE` (o la secuencia de `WORD`) cuyo texto normalizado contiene la etiqueta (`fecha de nacimiento`) y tomar su `Geometry.BoundingBox`.
   - De los `KEY_VALUE_SET` de tipo `KEY` cuyo texto normalizado **termina** en `dia`, `mes` o `ano` (después de `normalizeLabel`, "Año" queda como `ano`), quedarse con los que están en el mismo renglón: centro vertical a menos de una altura de renglón del de la etiqueta y a su derecha.
   - Si aparecen las tres partes, el valor es `AAAA-MM-DD` (día y mes con cero a la izquierda) y la confianza es la menor de las tres. Si falta alguna, dejar el campo vacío para que la persona lo escriba.
   - Respaldo si Textract no separa las llaves: aplicar `/fecha de nacimiento\s*dia\s*(\d{1,2})\s*mes\s*(\d{1,2})\s*ano\s*(\d{4})/` al texto normalizado del renglón.
3. Prueba unitaria con una respuesta real de `AnalyzeDocument` guardada como archivo de prueba (de una foto ficticia), para fijar la forma exacta de las llaves. La API de la app solo devuelve los campos ya mapeados, así que esta prueba no pudo ver los bloques crudos; por eso el arreglo cubre las dos formas posibles de las llaves.

### 2. Celular de img-03: el valor quedó fuera de la línea

En img-03 el celular está escrito arriba de la línea y corrido a la derecha. Textract encontró la llave "Celular" (confianza 0.90) pero no le asoció ningún valor. Aquí el mapeo sí encontró la etiqueta; el problema es la asociación llave-valor de Textract con escritura fuera de su lugar. La búsqueda igual encontró a la paciente por ID.

### 3. Guion de más en img-04

El celular vino como `55-0000-0040 -`. Los dígitos son correctos y la búsqueda compara solo dígitos, así que no afecta la detección, pero la persona vería el guion sobrante al confirmar.

### 4. La confianza no distingue lecturas dudosas

La confianza que guarda el mapeo es la menor entre la de la llave y la del valor del par (`KEY_VALUE_SET`). Esa cifra mide qué tan seguro está Textract de que existe el par, no qué tan bien leyó la letra. Por eso todo quedó entre 0.80 y 0.95, y un valor vacío salió con 0.90.

### 5. Año tachado (img-08): no se pudo evaluar

Como la fecha nunca se lee, no sabemos qué haría Textract con un año tachado y corregido. La detección de img-08 salió bien solo porque en la simulación se tecleó la fecha correcta.

## Cambios aplicados después de la primera pasada

En `apps/server/src/scans/textractMapping.ts` (desplegado en `b40cebc`, medido en la segunda pasada; ver "Antes y después"):

1. **Fechas en casillas Día / Mes / Año.** Para cada campo `fecha` de la plantilla (nacimiento, atención, FUM, última mastografía), si ninguna casilla trae la fecha completa, se arma con las llaves `Día`, `Mes` y `Año` que están en el mismo renglón que su etiqueta, en ese orden y de izquierda a derecha. En la tabla de "1. Fecha de atención" los valores van debajo de cada encabezado y se toman del valor de cada llave. Si Textract no formó pares, se leen las palabras del renglón ("Día 05 Mes 01 Año 1990") y se detiene en la siguiente etiqueta ("6. Edad en años"). Resultado en `AAAA-MM-DD`.
2. **Años de dos dígitos** con pivote en el año actual: en 2026, `90` → 1990 y `05` → 2005.
3. **Fechas imposibles** (mes 13, 30 de febrero, antes de 1900 o en el futuro): no se corrigen; se propone lo leído como `dd/mm/aaaa` con confianza 0.50 para que la persona lo arregle.
4. **Correcciones visibles**: si una casilla de la fecha trae dos números (año tachado y reescrito), se propone el último con confianza 0.50.
5. **Confianza por palabra**: la confianza es la menor de las palabras del valor, ya no la del par llave-valor. Si alguna palabra es letra a mano (`TextType: HANDWRITING`), se reescala para que **0.90 de Textract en letra a mano** quede justo en la línea de amarillo de la app (0.80, "Revisa este dato"). La letra de molde conserva su cifra.
6. **Valor fuera de la línea**: si la llave de un campo de texto viene sin valor, se buscan palabras a mano sueltas a la derecha de la llave, un poco arriba o abajo de su renglón, hasta la siguiente llave o etiqueta impresa ("Celular" limita a "Teléfono fijo"). Ese valor se propone con confianza máxima de 0.60, así que siempre sale en amarillo.
7. **Guion o punto sobrante** al final de un valor de texto (`55-0000-0040 -`): se quita.

Umbral de letra a mano: **0.90**, elegido antes de tener datos por palabra. La segunda pasada lo mantiene (ver "Umbral de amarillo con datos reales por palabra").

Pruebas: `apps/server/src/scans/textractMapping.test.ts`, sobre una página de Textract **sintética** (`apps/server/test/fixtures/textractForm.ts`) con las posiciones medidas en estas fotos y datos ficticios. No es una respuesta real guardada: la API de la app solo devuelve los campos ya mapeados y los resultados de la primera pasada no traen los bloques crudos de Textract. La segunda pasada confirmó que la fecha se arma bien con fotos reales (7 de 8), pero la página sintética no cubre una foto inclinada como img-02.

## Recomendaciones

Ya hechas (segunda pasada): mapeo de la fecha en casillas (0/8 → 7/8), confianza por palabra con letra a mano reescalada, corrección visible en amarillo (img-08) y guion sobrante del celular.

Pendientes, en orden de impacto:

1. **Marcar en amarillo un campo de identificación vacío cuando la plantilla lo espera** (por ejemplo, "No pudimos leer el celular; escríbelo si viene en el formato"). En las dos pasadas, todos los errores fueron campos vacíos, y ninguno salió en amarillo. Es lo que más ayudaría a la persona que confirma.
2. **Tolerar fotos inclinadas en las fechas** (img-02): comparar contra la recta del renglón usando `Geometry.Polygon`, no una franja horizontal.
3. **Búsqueda cercana del celular** (img-03): detenerse en la siguiente llave o en una etiqueta de la plantilla, no en cualquier palabra impresa.
4. **Pedir siempre confirmación de fecha de nacimiento, celular e ID**, aunque la confianza sea alta. Son los datos que deciden una coincidencia fuerte; un dígito mal leído cambia a la persona encontrada.
5. **Mantener la línea de amarillo en 0.80** (0.90 de Textract en letra a mano) hasta tener lecturas con errores reales. Con estas 16 lecturas no hubo ningún valor no vacío equivocado, así que no hay con qué ajustarla.
6. **Probar con formatos llenados a mano de verdad**. Aquí la "letra a mano" es una tipografía que Textract suele leer como impresa, así que la confianza y la búsqueda cercana no se pusieron a prueba con letra real.
7. Opcional, fuera de la SPEC actual: comparar el año leído contra "6. Edad en años" y la fecha de atención, y marcar en amarillo si no cuadran.
