# Guion de pruebas de punta a punta: Huella Rosa

Guion paso a paso para probar Huella Rosa **con y sin internet**. Está escrito para que lo siga una persona o un agente que maneja un navegador real (computer use). Los textos entre comillas son **exactos**: salen de `apps/web/src/i18n/es.ts` y del servidor. Si lo que ves en pantalla no coincide letra por letra, anótalo como falla (ver sección 6).

- App: http://localhost:5173 (servidor en :3001, Valkey en Docker).
- Todos los datos son ficticios. Teléfonos `55-0000-00XX`, ID `DEMO…`.
- `[verificar texto]` marca un texto o comportamiento que no se pudo confirmar en el código: anota lo que aparece en realidad.
- Las secciones marcadas **(requiere integrar bloque 3/4)** dependen de ramas que aún no están en `main` (`b3-scan`, `b3-excel`, `b4-admin`). Si no están integradas, márcalas como "No aplica".

## 1. Preparación

### 1.1 Levantar todo

En una terminal, desde la raíz del repo:

```
docker compose up -d      # Valkey
npm install
npm run db:migrate        # Prisma en apps/server
npm run seed
npm run dev               # web :5173 + servidor :3001
```

`npm run seed` debe terminar con una línea que empieza con `Seed OK: 5 users (lperez, jtorres, cruiz, mvega, smendez; PIN 1234)`.

### 1.2 Usuarios de demostración (PIN `1234` para todos)

| Usuario | Nombre | Rol en pantalla | Pantalla al entrar |
|---|---|---|---|
| `lperez` | Laura Pérez Ortiz | Captura | `/intake` ("Identifica a la paciente") |
| `jtorres` | Jorge Torres Navarro | Nutrición | `/queue` ("Pacientes esperándome") |
| `cruiz` | Dra. Carmen Ruiz Delgado | Médico | `/queue` |
| `mvega` | Dra. Mariana Vega Salinas | Patología | `/queue` |
| `smendez` | Sofía Méndez Aguilar | Administración | `/admin/audit` ("Bitácora"); con bloque 4 integrado: `/admin` ("Tablero de la jornada") |

### 1.3 Pacientes sembradas que usa este guion

| Paciente | Nacimiento | Celular | Para qué sirve |
|---|---|---|---|
| Lucía Ramírez Torres | 1990-01-05 (Jalisco) | 55-0000-0003 | Buscarla sin acentos: coincidencia fuerte (escenario A) |
| Juana Martínez García | 1972-07-30 (Michoacán) | 55-0000-0002 | Mismo dato cambiado en dos tabletas (F); casi duplicada en el Excel (I) |
| María Guadalupe Hernández López | 1985-03-12 (Jalisco) | 55-0000-0001 | Paciente del paquete para el escenario B |
| Rosa Flores Morales / Rosa Flores Mendoza | 1979-04-18 / 1995-09-02 | 55-0000-0006 / 55-0000-0007 | Solo el nombre parecido nunca basta |
| Ana Sánchez Cruz / Ana Cruz Sánchez | 1968-11-22 (Colima) | 55-0000-0004 / sin celular | Ya trae un "¿Es la misma persona?" abierto desde la semilla |

Jornadas: "Jornada mayo 2026" (anterior, con historial) y "Jornada noviembre 2026" (21 al 23 de noviembre de 2026, la que se descarga). Si pruebas en otra fecha, al registrar una visita aparece "La fecha de hoy está fuera de las fechas de esta jornada. Revisa que descargaste la jornada correcta." Eso no es falla.

### 1.4 Dos (o más) "tabletas"

Cada tableta es un almacenamiento separado del navegador: su propia IndexedDB, su propio id de dispositivo y su propia sesión.

- **Recomendado: dos perfiles de Chrome**, llamados "Tableta 1" y "Tableta 2" (menú de perfil > Agregar). Sobreviven a cerrar la ventana, lo que hace falta para entrar sin señal.
- Alternativa rápida: una ventana normal (Tableta 1) y una ventana de incógnito (Tableta 2). Cuidado: si cierras **todas** las ventanas de incógnito se borra su IndexedDB y la tableta "olvida" a quien entró.
- **Dos pestañas del mismo perfil son la misma tableta**: comparten datos y sesión. No las uses como tabletas distintas.
- Un usuario por tableta a la vez. Para cambiar de persona, pulsa "Salir" (arriba a la derecha) y entra con otro usuario. Si quedan cambios sin enviar, aparece una confirmación que empieza con "Hay 1 cambio sin enviar en esta tableta." (o "Hay N cambios…"); acepta solo si así lo pide el paso.

Asignación sugerida:

| Tableta | Usuarios que entran ahí |
|---|---|
| Tableta 1 | `lperez` (captura) |
| Tableta 2 | `jtorres`, luego `cruiz`, luego `mvega`; `lperez` en los escenarios E y F |
| Tableta 3 (opcional, otro perfil o incógnito) | `smendez` (administración, siempre con señal) |

### 1.5 Preparar cada tableta antes de cortar la señal

Sin señal solo puede entrar quien ya entró antes en esa tableta, y los folios se activan en la primera entrada con señal. Por eso, **con señal**, en cada tableta y para cada usuario que la vaya a usar sin señal:

1. Abre http://localhost:5173/login.
2. En "Usuario" escribe el usuario. En "Tu PIN" escribe `1234` (con el teclado o tocando los números en pantalla). Pulsa "Entrar".
3. Pulsa "Paquete de jornada" y luego "Descargar paquete" (o "Descargar paquete otra vez"). Espera "Listo. El paquete quedó guardado en esta tableta."
4. Comprueba arriba que dice "Jornada noviembre 2026" (en lugar de "Sin paquete de jornada").

### 1.6 Reiniciar entre corridas

1. Detén `npm run dev` (Ctrl+C) y corre `npm run seed`. Vuelve a correr `npm run dev`.
2. En **cada** tableta: abre DevTools (F12 o Cmd+Opción+I) > pestaña **Application** > **Storage** > botón **Clear site data**. Esto borra IndexedDB, la sesión, el id de dispositivo y el service worker.
3. Recarga la página **con señal** y repite la preparación 1.5.

## 2. Cortar y devolver la señal solo a la app

### Opción principal: DevTools > Network > Offline

1. En la pestaña de la app abre DevTools > pestaña **Network**.
2. En el selector de velocidad (dice "No throttling") elige **Offline**. Para devolver la señal elige de nuevo **No throttling**.
3. Aplica **solo a esa pestaña**: cada tableta se corta por separado. Deja DevTools abierto mientras dure la prueba.
4. Resultado esperado al cortar: arriba a la derecha cambia de "● Con señal" a "○ Sin señal". Al volver, regresa a "● Con señal" y los cambios pendientes se envían solos (en segundos; a más tardar en 30 segundos).

### Alternativa: detener el servidor

Detén solo el servidor (o todo `npm run dev`). Úsalo para simular "el servidor no responde". Ojo: el navegador sigue creyendo que hay red, así que el indicador **sigue en "● Con señal"**; los cambios se quedan en "N cambios por enviar" hasta que el servidor vuelve.

### Service worker y recargas

- La app debe cargarse **una vez con señal** antes de cortar (instala el service worker y guarda la sesión).
- En `npm run dev` el service worker de desarrollo no guarda todos los archivos: **no recargues la página mientras estás sin señal**; navega con los botones de la app. Para probar una recarga sin señal, usa la versión construida (`npm run build` y servir `apps/web/dist`) `[verificar texto]`.

## 3. Barra superior (siempre visible)

En todas las pantallas con sesión, la barra muestra:

- "Huella Rosa", el nombre de la jornada o "Sin paquete de jornada".
- Estado de envío: "N cambios por enviar" con "desde HH:MM" debajo, o "Todo enviado · HH:MM", o "Todo enviado", o "Aún no se envía nada".
- Si hay pasos esperando: "1 paso esperando a que llegue la visita" / "N pasos esperando a que llegue la visita".
- Si algo falló: "1 cambio necesita revisión" / "N cambios necesitan revisión".
- Botón "Enviar ahora" ("Enviando…" mientras envía).
- "● Con señal" o "○ Sin señal", y "Salir".

En pantalla **nunca** deben aparecer estas palabras: servidor, versión, sincronización/sincronizar, conflicto, operación, duplicado, ID interno, estados en inglés (`APPLIED`, `PENDING`, etc.). Si aparece alguna, es falla.

## 4. Escenarios

Convenciones: "T1" = Tableta 1, "T2" = Tableta 2, "T3" = Tableta 3. "Escribe" = teclear en el campo con esa etiqueta. "Pulsa" = clic en el botón o tarjeta con ese texto exacto.

### Formulario de búsqueda (se usa en varios escenarios)

Campos, en este orden: "Nombre completo"; "Nacimiento: día", "Mes", "Año" (números); "Un dato más (elige uno)" con las opciones "Teléfono", "ID del formato" o "Entidad de nacimiento", y el campo "Teléfono o celular" / "ID del formato (4. ID)" / "Entidad de nacimiento" según la opción. Botón "Buscar" ("Buscando…").

---

### A. Con señal: flujo completo

Ambas tabletas con señal. T1 = `lperez`, T2 = `jtorres`.

1. T1: entra como `lperez` (sección 1.5). Resultado esperado: título "Identifica a la paciente".
2. T1: si no hay paquete, pulsa "Paquete de jornada" > "Descargar paquete" y espera "Listo. El paquete quedó guardado en esta tableta." Regresa con "Regresar" o abre http://localhost:5173/intake.
3. T2: entra como `jtorres`. Resultado esperado: "Pacientes esperándome" y, si nadie espera, "Nadie te espera por ahora. Si tienes un formato en la mano, teclea su folio." Deja esta ventana visible.
4. T1: escribe "Nombre completo" = `Lucia Ramirez Torres` (sin acentos), día `05`, mes `01`, año `1990`; elige "Teléfono" y escribe `55-0000-0003`. Pulsa "Buscar".
5. Resultado esperado:
   - Título "¿Es alguna de ellas?" y debajo "Buscaste: …".
   - Una tarjeta "Lucía Ramírez Torres" con la etiqueta "Coincidencia fuerte".
   - "Motivos de la coincidencia" con: "Misma fecha de nacimiento", "Nombre parecido", "Mismo teléfono".
   - "Nació …", "Tel. termina en 0003", "Última visita: … · Jornada mayo 2026".
   - Botones "Es ella" y "Ver expediente"; al final "¿Ninguna es ella?" con "Es otra persona — registrar nueva".
6. T1: pulsa "Es ella". Resultado esperado: título "Visita de hoy · Lucía Ramírez Torres", subtítulo "Sus datos ya están llenos. Solo confirma o corrige lo que cambió.", sección "Sus datos".
7. T1: en "Escribe este folio en el formato:" **anota el folio** (forma `XX-000-X`, por ejemplo `B3-017-T`). En "Jornada" debe verse "Jornada noviembre 2026".
8. T1: en "Servicios de hoy (toca para marcar)" pulsa "Revisión mamaria" (debe cambiar a "Se hará hoy").
9. T1: en "Pasará con (toca para cambiar)" verifica que "Nutrición" y "Médico" dicen "Pasará hoy" (se marcan solos con Revisión mamaria). Si alguno dice "Toca para agregar", púlsalo.
10. T1: pulsa "Guardar visita". Resultado esperado: "Guardado ✓", "Folio <folio>: escríbelo en el formato de la paciente." y el botón "Ir al expediente". En la barra, "Todo enviado · HH:MM".
11. T2 (sin recargar): en unos segundos aparece una tarjeta "Lucía Ramírez Torres" con "Folio <folio> · registrada HH:MM" y el botón "Atender". Llega sola por el aviso en vivo del servidor; si tarda más de 30 segundos, anótalo como falla. (Con bloque 4 integrado, en T1 puede aparecer el aviso "Se envió 1 cambio" / "Se enviaron N cambios".)
12. T2: pulsa "Atender". Resultado esperado: título "Folio <folio> · Lucía Ramírez Torres", subtítulo "Tu paso: Nutrición. Llena solo tus campos; lo demás lo llenan las otras estaciones."
13. T2: en "Nombre que confirma la paciente" escribe `Lucía Ramírez Torres`. En "Campos de mi paso" deben verse **solo** "Talla", "Peso", "PA", "GLC", "BT", "AT" (no "22. BIRADS"). Escribe Talla `158`, Peso `62.5`, PA `118/76`, GLC `96`.
14. T2: pulsa "Guardar y terminar". Resultado esperado: regresa a "Pacientes esperándome" y la tarjeta ya no está.
15. T2: pulsa "Salir" y entra como `cruiz`. Resultado esperado: la tarjeta de Lucía aparece en "Pacientes esperándome". Pulsa "Atender"; el subtítulo dice "Tu paso: Médico. …".
16. T2: escribe el nombre confirmado. En "22. BIRADS" elige "Mama normal"; en "23. Conducta a seguir" elige "Detección de rutina en un año". Verifica que **no** aparecen "18. Resultados a la exploración clínica", "20. Resultados al ultrasonido", "21. Nombre, firma y cédula…" ni "Notas" (no se transcriben). Pulsa "Guardar y terminar".
17. T2: "Salir" y entra como `mvega`. Resultado esperado: Lucía **no** aparece en "Pacientes esperándome" (la revisión mamaria no pasa por Patología).
18. T2: "Salir" y entra como `cruiz`. Abre http://localhost:5173/patients ("Buscar expediente"), busca con los datos del paso 4 y pulsa "Ver expediente". Resultado esperado en "Historial de visitas": la visita de hoy ("Hoy, …" con "Folio <folio>"), con Nutrición y Médico como "hecho", y el resultado "BIRADS 1 · Mama normal" y "Conducta a seguir: Detección de rutina en un año". También se ve la visita de mayo 2026.
19. T1 (`lperez`): pulsa "Ir al expediente" (o búscala y pulsa "Ver expediente"). Resultado esperado: se ven "Datos de identificación" y las visitas, pero aparece "Sin resultados clínicos en esta vista" y en cada visita "Resultados: solo consulta clínica". No debe verse "BIRADS" ni la talla.

---

### B. Sin señal en captura

T1 = `lperez` preparada (1.5). T2 = `jtorres` con señal.

1. T1: corta la señal (sección 2). Resultado esperado: "○ Sin señal". En "Identifica a la paciente" aparece el recuadro "Funciona sin señal" con "La búsqueda usa el paquete de jornada guardado en esta tableta. Lo que registres se envía solo cuando vuelva la señal."
2. T1: busca a alguien del paquete: `Maria Guadalupe Hernandez Lopez`, `12` / `03` / `1985`, "Teléfono" `55-0000-0001`. Pulsa "Buscar". Resultado esperado: aparece "María Guadalupe Hernández López" con "Coincidencia fuerte". Pulsa "Cambiar datos" para volver.
3. T1: busca a una persona nueva: `Fernanda Ocampo Ríos`, `08` / `09` / `1987`, "Teléfono" `55-0000-0071`. Pulsa "Buscar".
4. Resultado esperado: "No encontramos a nadie con esos datos" con "Revisa que el nombre y la fecha estén bien escritos. Si están bien, regístrala." y el botón "No encontramos a nadie — registrar nueva". Si aparece alguna candidata, pulsa "Es otra persona — registrar nueva".
5. T1: en "Registrar paciente nueva" revisa los datos y pulsa "Registrar y seguir con la visita".
6. T1: en "Visita de hoy · Fernanda Ocampo Ríos" anota el folio, marca "Papanicolaou" (debe marcar "Patología" en "Pasará con") y pulsa "Guardar visita". Resultado esperado: "Guardado ✓".
7. T1: en la barra, "2 cambios por enviar" (o "N cambios por enviar") y debajo "desde HH:MM" `[verificar texto]` (el número exacto depende de cuántas operaciones guarda la app: registro + visita).
8. T2: entra como `mvega` con señal. Resultado esperado: Fernanda **todavía no** aparece.
9. T1: devuelve la señal. Resultado esperado: "● Con señal" y, sin pulsar nada, la barra pasa a "Todo enviado · HH:MM". Con bloque 4 integrado aparece "Se enviaron 2 cambios" (o "Se envió 1 cambio").
10. T2 (`mvega`): sin recargar, aparece "Fernanda Ocampo Ríos" en "Pacientes esperándome" con el folio anotado.

---

### C. Estaciones sin internet con el folio

T1 = `lperez`, T2 = `jtorres`, ambas preparadas (1.5) y ambas **sin señal**.

1. T1 y T2: corta la señal en las dos.
2. T1: busca `Rosa Flores Morales`, `18` / `04` / `1979`, "Teléfono" `55-0000-0006`. Resultado esperado: "Rosa Flores Morales" con "Coincidencia fuerte"; "Rosa Flores Mendoza" no debe salir como fuerte (fecha distinta). Pulsa "Es ella".
3. T1: anota el folio, marca "Revisión mamaria" (Nutrición y Médico en "Pasará hoy") y pulsa "Guardar visita". Resultado esperado: "Guardado ✓" y "1 cambio por enviar" o más.
4. T2 (`jtorres`): en "Pacientes esperándome" la paciente **no** aparece (la tableta no tiene señal). En "Teclear folio" > "Folio" escribe el folio anotado y pulsa "Abrir visita".
   - Si tecleas mal la última letra: "Revisa el folio: no coincide la última letra o le falta algo. Ejemplo: B3-017-T."
5. Resultado esperado: título "Folio <folio>" y el aviso "Esta visita aún no llega a esta tableta. Puedes registrar tu paso; se unirá al enviar." En "Historial": "Esta visita aún no llega. Puedes buscar a la paciente por nombre y fecha para ver su historial."
6. T2: en "Nombre que confirma la paciente" escribe `Rosa Flores Morales` (ayuda: "Pregúntale su nombre completo y compáralo con el formato."). Llena Talla `160`, Peso `65` y pulsa "Guardar y terminar".
7. Resultado esperado en T2: la barra muestra "1 paso esperando a que llegue la visita". En "Pacientes esperándome" aparece "Pasos que necesitan atención" con "Folio <folio>" y "Esperando a que llegue la visita".
8. T2: devuelve la señal **primero en T2** (T1 sigue sin señal). Resultado esperado: T2 sigue con "1 paso esperando a que llegue la visita" (no se pierde ni se rechaza).
9. T1: devuelve la señal. Resultado esperado: T1 pasa a "Todo enviado · HH:MM".
10. T2: en segundos (a más tardar 30 s, o pulsa "Enviar ahora") desaparece "1 paso esperando a que llegue la visita".
11. Verificación: en T2 sal y entra como `cruiz`. Rosa aparece **una sola vez** en "Pacientes esperándome" con el mismo folio (su paso de Médico sigue pendiente). Si aparece dos veces o con dos folios, es falla.

---

### D. Entrada sin señal

T1 con `lperez` ya preparada (1.5). `mvega` **nunca** entró en T1.

1. T1: pulsa "Salir". Corta la señal.
2. Resultado esperado en "Entrar": el aviso "Sin señal: solo puede entrar quien ya entró antes en esta tableta."
3. T1: "Usuario" `lperez`, "Tu PIN" `1234`, pulsa "Entrar". Resultado esperado: entra a "Identifica a la paciente".
4. T1: "Salir". "Usuario" `mvega`, PIN `1234`, "Entrar". Resultado esperado: no entra y aparece "Sin señal solo puede entrar quien ya entró antes en esta tableta. Busca señal para entrar por primera vez."
5. T1, todavía sin señal: "Usuario" `lperez`, PIN `9999`, "Entrar", cinco veces seguidas. Resultado esperado, uno por intento:
   1. "PIN incorrecto. Te quedan 4 intentos; después este usuario se bloquea 15 minutos en esta tableta."
   2. "PIN incorrecto. Te quedan 3 intentos; …"
   3. "PIN incorrecto. Te quedan 2 intentos; …"
   4. "PIN incorrecto. Te queda 1 intento; después este usuario se bloquea 15 minutos en esta tableta."
   5. "Este usuario está bloqueado en esta tableta. Espera 15 minutos e intenta de nuevo."
6. T1: intenta con el PIN correcto `1234`. Resultado esperado: sigue el mensaje de bloqueo ("Espera N minutos…").
7. (Con señal, opcional) Cinco PIN malos de un mismo usuario: "El usuario o el PIN no coinciden. Revisa e intenta de nuevo." y al sexto "Demasiados intentos. Espera 15 minutos o pide ayuda." `[verificar texto]` (mensajes del servidor; confirmar que la pantalla los muestra tal cual).
8. Para seguir probando, limpia los datos del sitio de T1 (1.6) o usa otra tableta.

---

### E. Persona registrada dos veces sin señal (requiere integrar bloque 4 para el paso 7 en adelante)

T1 y T2 con `lperez` preparada (1.5) en cada una. T3 = `smendez` con señal.

1. T1 y T2: corta la señal en ambas.
2. T1: busca `Rocío Delgado Pineda` (con acento), `10` / `04` / `1988`, "Teléfono" `55-0000-0091`. Resultado esperado: "No encontramos a nadie con esos datos". Pulsa "No encontramos a nadie — registrar nueva" > "Registrar y seguir con la visita". Marca "Revisión mamaria", pulsa "Guardar visita". Resultado esperado: "Guardado ✓".
3. T2: lo mismo con `Rocio Delgado Pineda` (sin acento), misma fecha y mismo teléfono. Resultado esperado: tampoco la encuentra (T2 no sabe de T1). Registra y guarda la visita.
4. T1: devuelve la señal; espera "Todo enviado · HH:MM".
5. T2: devuelve la señal; espera "Todo enviado · HH:MM". Ninguna tableta muestra error.
6. Sin bloque 4: como `smendez` en http://localhost:5173/admin/audit ("Bitácora") debe aparecer un movimiento de que se abrió una revisión de registros parecidos `[verificar texto]`.
7. T3: entra como `smendez`. Resultado esperado: "Tablero de la jornada" con "¿Es la misma persona? por revisar" mayor o igual a 2 (la semilla trae una: Ana Sánchez Cruz / Ana Cruz Sánchez).
8. T3: abre "¿Es la misma persona?" (menú o http://localhost:5173/admin/matches). Resultado esperado: subtítulo "Dos registros se parecen. Revisa sus datos y decide. Nada se borra: unir conserva los dos registros." Una pareja muestra "Rocío Delgado Pineda" y "Rocio Delgado Pineda", cada una con "Registrada por Laura Pérez Ortiz · …", la sección "Por qué se parecen" y la leyenda "Los datos resaltados son distintos entre los dos registros."
9. T3: bajo "Si es la misma persona, elige cuál registro queda como principal:" pulsa "Es la misma: dejar este como principal" en el registro con acento. Confirma el diálogo "¿Unir estos dos registros? Los dos se conservan y su historial se verá junto."
10. Resultado esperado: "Listo: quedaron unidos. Su historial ya se ve junto."
11. Verificación: como `lperez` en T1 busca a Rocío y abre el expediente. Resultado esperado: "Este expediente está vinculado con 1 registro más." y en "Historial de visitas" aparecen **las dos** visitas. Buscar "Rocio Delgado Pineda" sigue encontrando el otro registro (no se borró).
12. Variante: en la pareja de Ana pulsa "Son personas distintas". Resultado esperado: "Listo: quedan como personas distintas."

---

### F. El mismo dato cambiado en dos tabletas (requiere integrar bloque 4 para el paso 7 en adelante)

T1 y T2 con `lperez` preparada (1.5). T3 = `smendez` con señal.

1. T1 y T2: corta la señal en ambas.
2. T1: busca `Juana Martinez Garcia`, `30` / `07` / `1972`, "Teléfono" `55-0000-0002`; pulsa "Es ella".
3. T1: en "Sus datos", en "Celular" pulsa "Corregir", escribe `55-0000-0092` y pulsa "Listo" (debe decir "Corregido"; "Deshacer cambio" lo revierte). Marca "Revisión mamaria" y pulsa "Guardar visita". Resultado esperado: "Guardado ✓".
4. T2: lo mismo, pero escribe `55-0000-0093`. Guarda la visita.
5. T1: devuelve la señal; espera "Todo enviado · HH:MM".
6. T2: devuelve la señal. Resultado esperado: no se pisa en silencio. La corrección de T2 queda para revisión con el aviso "Alguien más cambió este dato: lo revisará administración." o "Alguien más cambió Celular antes que tú. Se conservó lo que ya estaba guardado y administración lo revisará." `[verificar texto]` (confirmar en qué pantalla aparece: barra con "1 cambio necesita revisión", "Paquete de jornada" > "Cambios que necesitan revisión", o el resultado del guardado).
7. T3: entra como `smendez` y abre "Dos personas cambiaron el mismo dato" (menú o http://localhost:5173/admin/conflicts). Resultado esperado: subtítulo "Mientras no había señal, dos personas escribieron un valor distinto en el mismo dato. Elige cuál se queda.", "Paciente: Juana Martínez García", el dato "Celular" con "Lo que ya estaba guardado" = `55-0000-0092` y "Lo que capturó Laura Pérez Ortiz sin señal" = `55-0000-0093`, cada uno con persona y hora.
8. T3: pulsa "Usar lo nuevo". Resultado esperado: "Guardado ✓" y la lista termina en "No hay datos por revisar. ✓".
9. Verificación: el expediente de Juana muestra "Celular" = `55-0000-0093`. (Repite con "Dejar lo guardado" en otra corrida para probar la otra opción.)

---

### G. Permisos

1. Captura no ve resultados clínicos: repite el paso 19 del escenario A. Resultado esperado: "Sin resultados clínicos en esta vista" y "Resultados: solo consulta clínica".
2. Captura no ve la bitácora: en T1 como `lperez` abre http://localhost:5173/admin/audit. Resultado esperado: no se muestra la bitácora; la app la regresa a "Identifica a la paciente" (también aplica a `/admin`, `/admin/matches` y `/admin/conflicts` con bloque 4).
3. Captura no entra a pantallas de especialistas: como `lperez` abre http://localhost:5173/queue. Resultado esperado: no muestra "Pacientes esperándome"; regresa a "Identifica a la paciente".
4. Nutrición no puede guardar campos del médico:
   - En la interfaz: como `jtorres`, al atender una visita de Revisión mamaria, "Campos de mi paso" muestra solo "Talla", "Peso", "PA", "GLC", "BT", "AT". No aparecen "22. BIRADS" ni "23. Conducta a seguir".
   - En el servidor (lo verifica la persona que desarrolla, no el agente): si se envía al servidor un campo del médico con la sesión de `jtorres`, se rechaza con "Estos campos no son de tu especialidad: 22. BIRADS." `[verificar texto]` (con bloque 4 el mensaje usa la etiqueta de la plantilla; sin bloque 4 muestra la clave `birads`).
5. Captura no puede vincular: el servidor responde 403 con "Tu rol no tiene permiso para esta acción." (verificación de desarrollo, no del agente).
6. Administración ve la bitácora: en T3 como `smendez` abre "Bitácora" (http://localhost:5173/admin/audit).
   - Sin bloque 4: título "Bitácora", subtítulo "Quién hizo qué, cuándo y desde qué tableta.", columnas "Cuándo", "Quién", "Acción", "Tableta", "Detalle". Deben verse las acciones del escenario A.
   - Con bloque 4: subtítulo "Busca a la paciente para ver todo lo que pasó con su expediente." Busca a Lucía (datos del escenario A) y elígela. Resultado esperado: "Bitácora de Lucía Ramírez Torres" con frases como "Laura Pérez Ortiz reconoció que ya había venido antes", "Laura Pérez Ortiz registró la visita <folio>", "Jorge Torres Navarro llenó … en la visita <folio>", "Jorge Torres Navarro terminó Nutrición en la visita <folio>", "Dra. Carmen Ruiz Delgado terminó Médico en la visita <folio>", cada una con hora y "tableta …". Botón "Buscar otra paciente".

---

### H. Foto del formato (requiere integrar bloque 3)

Archivos: `datos-ficticios/formatos/formato-01.svg` (Lucía Ramírez Torres, recurrente), `formato-02.svg` (Carmen Ortiz Reyes, nueva), `formato-03.svg` (Patricia Luna Herrera, fecha de nacimiento poco clara). El servidor debe estar en `OCR_MODE=mock`; la lectura se elige por el nombre del archivo, así que **no renombres los archivos**.

1. T1 `lperez` con señal, en "Identifica a la paciente". Resultado esperado: el botón "Identificar con foto".
2. Pulsa "Identificar con foto". Resultado esperado: título "Identificar con foto", subtítulo "Toma la foto del formato completo, derecho y con buena luz." Pulsa "Tomar foto del formato" y elige `formato-01.svg` en el selector de archivos. (En escritorio se abre el selector de archivos; si el navegador no acepta SVG, anótalo `[verificar texto]`.)
3. Resultado esperado: "Leyendo el formato…" y luego "Confirma los datos de identificación" con "Compáralos con la foto. Nada se guarda sin tu confirmación." Campos: "Nombre completo" = Lucía Ramírez Torres, "Fecha de nacimiento (DD/MM/AAAA)" = 05/01/1990, "ID del formato" = DEMO0000003, "Entidad de nacimiento" = Jalisco, "Celular" = 55-0000-0003, "Residencia habitual" = Rancho Prueba. Nota: "Los datos clínicos los confirma cada especialista en su paso, viendo esta foto." No aparecen datos clínicos (BIRADS, talla) en esta pantalla.
4. Pulsa "Confirmar y buscar". Resultado esperado: vuelve a "Identifica a la paciente" con los datos llenos y busca sola; aparece "Lucía Ramírez Torres" como coincidencia.
5. Repite con `formato-03.svg`. Resultado esperado: "1 dato con letra poco clara. Revísalo con la foto." y el campo "Fecha de nacimiento (DD/MM/AAAA)" (valor 09/02/1975) resaltado en ámbar con "Revisa este dato".
6. Con `formato-02.svg`, después de buscar, registra a Carmen Ortiz Reyes como nueva y llega a la visita.
7. Adjuntar con señal: en "Visita de hoy · …" pulsa "Adjuntar foto del formato" y elige `formato-02.svg`. Resultado esperado: "Guardado ✓" y la ayuda "Se guarda en la tableta y se envía sola cuando haya señal. Cada especialista confirma sus datos viendo la foto."
8. Sin señal: corta la señal en T1. Resultado esperado: en "Identifica a la paciente" **no** aparece "Identificar con foto".
9. Sin señal, abre una visita (busca a alguien del paquete > "Es ella") y pulsa "Adjuntar foto del formato" con `formato-01.svg`. Resultado esperado: "Guardado ✓ · se leerá cuando vuelva la señal" y en la barra "1 foto por enviar" `[verificar texto]` (confirmar dónde se muestra).
10. Devuelve la señal: la foto se envía sola. Como `jtorres`, al atender esa visita aparece "Foto del formato" y "Llenamos tus datos con lo que se leyó en la foto. Revísalos antes de guardar." Si guardas sin marcar "Revisé los datos sugeridos con la foto": "Revisa los datos sugeridos con la foto y marca la casilla."

---

### I. Excel (requiere integrar bloque 3)

Archivo: `datos-ficticios/excel/plantilla-llena.xlsx` (5 renglones ficticios).

1. T1 `lperez` con señal. En "Identifica a la paciente" pulsa "Importar desde Excel". Resultado esperado: título "Importar desde Excel" y "Sube la lista de pacientes de una brigada. Nada se guarda solo: revisas cada renglón antes de registrarla."
2. En "1. Descarga la plantilla" pulsa "Descargar plantilla". Resultado esperado: se descarga un archivo `.xlsx`. No lo abras fuera de la app (el agente solo comprueba que se descargó).
3. En "2. Sube el archivo lleno" pulsa "Elegir archivo" y elige `plantilla-llena.xlsx`. Resultado esperado: "Subiendo…" y luego la revisión "Revisa el archivo plantilla-llena.xlsx" con "5 renglones · Nada se guarda hasta que tú lo confirmes."
4. Resultado esperado en grupos:
   - "Nuevas (3)": Patricia Núñez Salazar, Verónica Ibarra Quintero, Teresa Olvera Campos.
   - "¿Es alguna de ellas? (1)": Juana Martinez Garcia, comparada con "Juana Martínez García" (botones "Es ella" y "Es otra persona — registrar").
   - "Con datos por corregir (1)": Carmen Ruelas Pineda (31/02/1990 no existe), con "Descartar".
5. Antes de decidir: busca `Patricia Nuñez Salazar`, `14` / `02` / `1981` en "Identifica a la paciente". Resultado esperado: "No encontramos a nadie con esos datos" (nada se registró todavía). Si la búsqueda se hace con el paquete, descárgalo otra vez antes `[verificar texto]`.
6. Pulsa "Registrar todas las nuevas (3)". Resultado esperado: el diálogo "¿Registrar las 3 pacientes nuevas?" con "Sí, registrar las 3"; al aceptar, "Guardado ✓ 3 registradas."
7. En Juana pulsa "Es ella". Resultado esperado: "Agregada a su expediente ✓" (nota: "Es ella: a su expediente solo se agregan los datos que le faltan. Lo que ya estaba guardado no cambia.").
8. En Carmen Ruelas pulsa "Descartar". Resultado esperado: "Descartada" y al final "Revisaste todo el archivo ✓".
9. En "Archivos subidos" el archivo aparece con "Revisado ✓".
10. Sin señal: en "Importar desde Excel" aparece "Para importar un Excel necesitas señal. Lo que captures en la tableta sigue funcionando sin señal."

## 5. Lista final

Marca cada renglón con OK, Falla o Nota (con la referencia de captura de pantalla).

### Puntos de demostración del reto

| # | Punto del reto | Dónde se prueba | OK / Falla / Nota |
|---|---|---|---|
| 1 | Alta de paciente | B (pasos 3-6), E (paso 2) | |
| 2 | Búsqueda y coincidencia con motivos (sin acentos; solo el nombre no basta) | A (pasos 4-5), C (paso 2) | |
| 3 | Segunda visita con historial | A (pasos 6-10 y 18) | |
| 4 | Trabajo sin conexión verificable | B, C, D (pasos 1-4) | |
| 5 | Control de acceso por rol | A (pasos 17 y 19), D (paso 5), G | |

### Pruebas manuales de `docs/PLAN.md`

| Prueba | Dónde se prueba | OK / Falla / Nota |
|---|---|---|
| Una búsqueda solo por nombre nunca se marca como coincidencia fuerte | C (paso 2: Rosa Flores Mendoza); busca también `Rosa Flores` con otra fecha y otro teléfono | |
| Nada se vincula sin pulsar "Es ella" o "Vincular" | A (paso 6), E (paso 9: "Es la misma: dejar este como principal") | |
| Vincular no borra ningún registro; el historial aparece unido | E (paso 11) | |
| En modo avión se registran paciente, visita y servicio; al volver la señal se sincronizan | B | |
| Reenviar la misma operación no la duplica | C (paso 11); pulsar "Enviar ahora" varias veces en B no crea visitas repetidas | |
| El mismo campo editado en dos dispositivos crea un conflicto, no se pisa | F | |
| Dos altas sin señal de la misma persona abren un posible duplicado | E (pasos 6-8) | |
| Captura no ve resultados clínicos; captura no puede vincular (403) | A (paso 19), G (pasos 1, 2 y 5) | |
| Los campos leídos del formato no se guardan sin confirmar | H (pasos 3-4 y 10) | |
| La bitácora muestra todo el recorrido de una paciente | G (paso 6) | |
| Un Excel subido no crea ningún expediente hasta que captura confirma cada fila | I (paso 5) | |
| Ninguna herramienta MCP puede confirmar, vincular ni leer datos clínicos; un token revocado responde 401 | Fuera de este guion (no se prueba en el navegador) | |

## 6. Reglas para quien prueba (persona o agente)

1. **Nunca uses datos reales.** Usa solo los datos de este guion o inventa con las mismas reglas: nombres comunes combinados, teléfonos `55-0000-00XX`, ID `DEMO…`.
2. **Nunca escribas fuera de la app**: ni en la consola de DevTools, ni en la barra de direcciones salvo las URL de este guion, ni en otras páginas o programas. DevTools se usa solo para cortar la señal (Network) y limpiar datos (Application).
3. **Reporta cada diferencia** entre el texto esperado y el real con este formato: escenario y paso, texto esperado, texto real, referencia de la captura de pantalla (por ejemplo `A-05.png`). Toma captura también de cada "Resultado esperado" que pase.
4. Si un paso falla, anótalo y sigue con el siguiente escenario; no intentes arreglar nada.
5. Si aparece en pantalla una palabra prohibida (sección 3), es una falla aunque el flujo funcione.
6. Los textos marcados `[verificar texto]` no son fallas por sí mismos: anota el texto que aparece en realidad.
