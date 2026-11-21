# Pruebas de lectura de formatos (OCR) en producción

Fecha: 2026-11-21. Servidor: `https://huella-rosa.jjjl.dev` con `OCR_MODE=textract` (AWS Textract, `AnalyzeDocument` con `FORMS`). Usuaria: captura (`intake`).

## Qué se probó

8 fotos de formatos de revisión mamaria llenados a mano con datos ficticios (no están en el repo). Para cada foto:

1. Se sube con `POST /api/scans`, como lo hace "Identificar con foto".
2. Se comparan los 6 campos de identificación propuestos (`fullName`, `birthDate`, `birthState`, `formId`, `mobile`, `residence`) con los valores esperados. La comparación ignora mayúsculas, acentos y espacios; las fechas se comparan en `AAAA-MM-DD` y los teléfonos solo por dígitos. Un campo vacío en papel cuenta como correcto si la lectura también viene vacía.
3. Se corre la misma búsqueda que hace la app después de confirmar (`draftFromScan`): nombre + fecha de nacimiento + celular; si no hay celular, el ID; si no, la entidad.

Script: `scripts/ocr-eval/run.ts` (instrucciones al inicio del archivo; `npm run ocr:eval`).

Costo: una sola pasada contra Textract, 8 páginas, unos USD 0.40 (USD 0.05 por página con `FORMS`), dentro de la autorización previa. La segunda corrida reutilizó las lecturas guardadas (`OCR_REPLAY`) y no llamó a Textract. Efecto en producción: quedaron 8 registros de formato (`FormScan`) en estado `READ`, sin visita, subidos por la usuaria de prueba, con sus imágenes.

## Resultado por imagen

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

## Precisión por campo (8 imágenes)

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

## Qué falló y por qué

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

## Cambios aplicados después de la primera pasada (pendiente de medir)

En `apps/server/src/scans/textractMapping.ts`, todavía sin desplegar ni medir con Textract:

1. **Fechas en casillas Día / Mes / Año.** Para cada campo `fecha` de la plantilla (nacimiento, atención, FUM, última mastografía), si ninguna casilla trae la fecha completa, se arma con las llaves `Día`, `Mes` y `Año` que están en el mismo renglón que su etiqueta, en ese orden y de izquierda a derecha. En la tabla de "1. Fecha de atención" los valores van debajo de cada encabezado y se toman del valor de cada llave. Si Textract no formó pares, se leen las palabras del renglón ("Día 05 Mes 01 Año 1990") y se detiene en la siguiente etiqueta ("6. Edad en años"). Resultado en `AAAA-MM-DD`.
2. **Años de dos dígitos** con pivote en el año actual: en 2026, `90` → 1990 y `05` → 2005.
3. **Fechas imposibles** (mes 13, 30 de febrero, antes de 1900 o en el futuro): no se corrigen; se propone lo leído como `dd/mm/aaaa` con confianza 0.50 para que la persona lo arregle.
4. **Correcciones visibles**: si una casilla de la fecha trae dos números (año tachado y reescrito), se propone el último con confianza 0.50.
5. **Confianza por palabra**: la confianza es la menor de las palabras del valor, ya no la del par llave-valor. Si alguna palabra es letra a mano (`TextType: HANDWRITING`), se reescala para que **0.90 de Textract en letra a mano** quede justo en la línea de amarillo de la app (0.80, "Revisa este dato"). La letra de molde conserva su cifra.
6. **Valor fuera de la línea**: si la llave de un campo de texto viene sin valor, se buscan palabras a mano sueltas a la derecha de la llave, un poco arriba o abajo de su renglón, hasta la siguiente llave o etiqueta impresa ("Celular" limita a "Teléfono fijo"). Ese valor se propone con confianza máxima de 0.60, así que siempre sale en amarillo.
7. **Guion o punto sobrante** al final de un valor de texto (`55-0000-0040 -`): se quita.

Umbral elegido: **0.90 para letra a mano**. Es provisional. La primera pasada solo dejó ver la confianza del par llave-valor (0.80 a 0.95 en valores correctos) y ningún valor no vacío salió mal, así que estos datos no permiten fijar el umbral por palabra. Se confirma o ajusta con la siguiente pasada.

Pruebas: `apps/server/src/scans/textractMapping.test.ts`, sobre una página de Textract **sintética** (`apps/server/test/fixtures/textractForm.ts`) con las posiciones medidas en estas fotos y datos ficticios. No es una respuesta real guardada: la API de la app solo devuelve los campos ya mapeados y los resultados de la primera pasada no traen los bloques crudos de Textract. La forma exacta en que Textract agrupa estas casillas se confirma en la siguiente pasada.

## Recomendaciones

1. **Corregir el mapeo de la fecha de nacimiento** (arreglo de arriba). Es lo único que impide la identificación con foto de punta a punta: con la fecha tecleada, la detección fue 8/8.
2. **Pedir siempre confirmación de fecha de nacimiento, celular e ID**, aunque la confianza sea alta. Son los datos que deciden una coincidencia fuerte; un dígito mal leído cambia a la persona encontrada. El nombre y la entidad salieron exactos en las 8 fotos, pero también pasan por la misma pantalla de confirmación.
3. **Marcar en amarillo un campo de identificación vacío cuando la plantilla lo espera** (por ejemplo, "No pudimos leer el celular; escríbelo si viene en el formato"). Hoy solo se marcan valores no vacíos.
4. **Usar la confianza de las palabras del valor** (`WORD.Confidence`, la menor) en lugar de la del par llave-valor, y subir el umbral de amarillo a **0.90** para letra a mano. Con la cifra actual, ningún umbral entre 0.80 y 0.95 separa lecturas buenas de malas en esta muestra (no hubo lecturas malas con valor). Volver a medir con el arreglo de la fecha antes de fijar el número.
5. **Limpiar el valor del celular**: quitar guiones o espacios al final antes de proponerlo.
6. **Repetir la prueba después del arreglo** (una pasada, unos USD 0.40) para medir la fecha, incluido el año tachado de img-08. Opcional, fuera de la SPEC actual: comparar el año leído contra "6. Edad en años" y la fecha de atención, y marcar en amarillo si no cuadran.
