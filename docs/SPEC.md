# Especificación del producto: Expediente Rosa

Reto 1 del Nerdearla Vibeathon México 2026 (EIRA Movimiento Rosa A.C.):
**expediente digital único y registro de pacientes, aun con conectividad intermitente.**

Texto del reto (Devpost):

> Diseñar un mecanismo de registro y consulta que permita reconocer a una paciente recurrente, conservar su historial de servicios y actualizar solo la información necesaria, aun con conectividad intermitente. Hoy las pacientes se identifican por nombre completo y una mujer que acude cuatro veces en un año puede registrarse cuatro veces.
>
> - Identificador interno estable por paciente; visitas y servicios registrados por separado.
> - Búsqueda de coincidencias por varios atributos, con confirmación humana antes de vincular expedientes (nunca fusionar automáticamente).
> - Captura local sin internet y sincronización segura con detección de conflictos.
> - Roles de captura, consulta clínica y administración; bitácora de cambios.
>
> _Lo que puede demostrar un prototipo en un día:_ alta de una paciente ficticia, búsqueda y detección de coincidencia, segunda visita con historial, simulación verificable de trabajo sin conexión y explicación del control de acceso.

## 1. Problema

- En cada jornada el personal llena **formatos en papel** (por ejemplo, el formato de revisión mamaria) y el mismo día los vuelve a capturar en Google Forms o Excel. Es trabajo doble y se cuelan errores.
- La paciente se identifica por su **nombre completo**. Si acude cuatro veces en un año, puede quedar registrada cuatro veces y su historial se parte.
- Las jornadas ocurren en comunidades **sin señal estable**. Cualquier sistema que dependa de internet se cae justo donde más se necesita.
- EIRA es un equipo chico: no puede sostener procesos complejos ni herramientas caras.

## 2. Propuesta de valor

1. **Una paciente, un expediente.** Identificador interno estable creado en el dispositivo, aun sin red. Visitas y servicios registrados por separado.
2. **Reconocer a quien regresa.** Búsqueda por varios atributos (nombre, fecha de nacimiento, entidad de nacimiento, teléfono, localidad, ID del formato). El sistema propone coincidencias y explica por qué; **una persona decide**. Nunca se fusiona en automático.
3. **Funciona sin internet.** Todo se captura en el dispositivo y se sincroniza cuando vuelve la señal, con detección de conflictos campo por campo.
4. **Del papel al expediente en segundos.** Foto del formato, lectura automática de los campos de identificación y una persona confirma viendo el original. Si no hay señal, la foto espera en cola y se lee al sincronizar.

Principio de diseño: **la tecnología hace el trabajo repetitivo; las personas toman las decisiones.**

## 3. Límites que no se negocian

- Solo datos ficticios. El prototipo no autoriza su uso con pacientes reales.
- El nombre nunca es identificador ni criterio único de coincidencia.
- No vincular ni fusionar expedientes sin confirmación humana explícita. Vincular conserva ambos registros; no borra nada.
- La lectura automática (OCR) solo propone valores de campos definidos en `plantillas/*.json`. No interpreta, no resume, no diagnostica. Todo valor leído se confirma antes de guardarse.
- El texto clínico libre escrito a mano (por ejemplo, secciones 18 y 20 del formato mamario) no se transcribe: se conserva la imagen.
- Cada cambio queda en bitácora (quién, qué, cuándo, desde qué dispositivo).
- La validación de rol se hace en el servidor, no solo en la interfaz.
- El dispositivo guarda solo lo necesario para la jornada.

## 4. Roles

| Rol | Puede | No puede |
|---|---|---|
| Captura | Buscar pacientes, dar de alta, registrar visitas y servicios, digitalizar formatos, trabajar sin conexión | Ver resultados clínicos de visitas anteriores; vincular expedientes; resolver conflictos |
| Consulta clínica | Ver el historial completo de una paciente, registrar la evaluación del servicio, confirmar los campos clínicos leídos de un formato, resolver conflictos en campos clínicos | Vincular expedientes; administrar usuarios |
| Administración | Revisar posibles duplicados y vincular, resolver conflictos en campos no clínicos, consultar la bitácora, crear jornadas | Ver o editar datos clínicos |

En el prototipo el personal entra con usuarios de demostración sembrados. En un piloto: Amazon Cognito con MFA.

## 5. Modelo de datos

Los nombres en código están en inglés (ver glosario en `CLAUDE.md`).

```
Patient        id (UUID creado en el dispositivo), formId? (campo "4. ID" del formato),
               fullName, birthDate, birthState?, phone?, mobile?, residence?, localityId?,
               affiliation?, createdAt, createdBy, deviceId, version, linkedToId?

Visit          id, patientId, campaignId, date, folio? ("Folio Eira"), createdBy, deviceId, version

Service        id, visitId, type [BREAST_REVIEW | ULTRASOUND | PAP | MAMMOGRAPHY],
               templateId, data (JSON con los campos de la plantilla), formImageRef?,
               status [DRAFT | CONFIRMED], confirmedBy?, confirmedAt?, version

Campaign       id, name, municipality, state, date, localityIds        ("jornada")
Locality       id, name, municipality, hasSignal
User           id, name, role [intake | clinician | admin]

MatchReview    id, patientAId, patientBId, score, reasons, status [OPEN | LINKED | DISMISSED],
               decidedBy?, decidedAt?                                   ("posible duplicado")
SyncConflict   id, entity, entityId, field, serverValue, deviceValue, deviceId, userId,
               status [OPEN | RESOLVED], resolvedBy?, resolvedAt?
FormScan       id, imageRef, templateId, status [QUEUED | READ | CONFIRMED | FAILED],
               extracted (JSON con valor y confianza por campo), visitId?
ImportBatch    id, source [TEMPLATE | EXCEL | MCP], fileName?, columnMapping (JSON),
               createdBy (usuario o "agent:<token>"), status [OPEN | DONE], createdAt
ImportRow      id, batchId, rowNumber, data (JSON con campos de identificación),
               status [NEW | POSSIBLE_MATCH | INVALID | CONFIRMED | DISCARDED],
               reason?, candidates (JSON), patientId?, decidedBy?, decidedAt?
AgentToken     id, name, tokenHash, role (siempre intake), createdBy, revokedAt?
AuditLog       id, at, actorId, deviceId, action, entity, entityId, detail
```

- `version` por registro y por campo permite detectar conflictos al sincronizar.
- `linkedToId`: al vincular, el registro duplicado apunta al expediente principal. El historial se muestra unido; ningún dato se borra.

## 6. Flujos

### 6.1 Preparar la jornada (con señal)

1. Administración crea la jornada (municipio, fecha, localidades).
2. Cada dispositivo de captura descarga el **paquete de jornada**: índice mínimo de las pacientes de esas localidades (nombre, fecha de nacimiento, entidad de nacimiento, huella SHA-256 del teléfono normalizado, ID del formato) y su lista de visitas previas sin datos clínicos. Es lo que permite buscar coincidencias sin red. El teléfono viaja como huella: sirve para comparar si es el mismo número sin guardar el número en el dispositivo.

### 6.2 Identificar primero, registrar después (con o sin señal)

Regla de la pantalla de captura: **no existe un botón de "alta nueva" antes de buscar.** Al llegar la paciente, lo primero es identificarla; el registro nuevo solo aparece cuando la búsqueda no encontró a nadie o la persona confirmó que es otra.

1. Captura escribe algunos datos (o los toma de la foto, ver 6.4): nombre, fecha de nacimiento y al menos otro atributo.
2. El sistema busca en el paquete local (y en el servidor si hay señal) y muestra candidatas con **puntaje y motivos** ("misma fecha de nacimiento", "nombre parecido", "mismo teléfono").
3. Reglas de puntaje (deterministas, sin IA):
   - ID del formato igual: coincidencia fuerte.
   - Fecha de nacimiento igual + nombre similar (sin acentos, orden de apellidos flexible): fuerte.
   - Teléfono igual + fecha de nacimiento igual: fuerte.
   - Solo nombre similar: débil; nunca basta.
4. Captura elige **"Es ella"** (nueva visita en su expediente, con sus datos ya llenos: solo se confirma o corrige lo que cambió) o **"Es otra persona"** (alta nueva). Ambas decisiones quedan en bitácora.
5. La visita registra la jornada, el folio del formato y los servicios del día.

### 6.3 Segunda visita con historial

1. Al elegir "Es ella", se muestra el historial: visitas anteriores con fecha, jornada y servicios.
2. Captura actualiza solo lo que cambió (por ejemplo, teléfono). Cada cambio guarda versión y bitácora.
3. Consulta clínica ve además los resultados registrados en cada servicio.

### 6.4 Digitalizar un formato

1. Captura toma foto del formato (o sube una imagen o PDF).
2. **Con señal:** la imagen sube al almacenamiento y se lee con el modo configurado en `OCR_MODE`:
   - `mock`: lee `datos-ficticios/formatos/*.json` (demo sin red).
   - `textract`: AWS Textract (formularios y casillas).
3. **Sin señal:** la foto queda en la cola del dispositivo y se lee al sincronizar.
4. Pantalla de confirmación: imagen original a un lado, campos propuestos al otro. Los campos con baja confianza se marcan en amarillo. Nada se guarda sin confirmar.
5. **Captura confirma solo los campos de identificación** (los que alimentan la búsqueda). Con ellos se ejecuta la búsqueda de coincidencias (6.2).
6. Los campos marcados para `clinician` en la plantilla (signos vitales, factores de riesgo, BIRADS, referencia) no se muestran a captura: quedan pendientes y **consulta clínica los confirma** desde el expediente, viendo la imagen.

### 6.5 Sincronización y conflictos

1. Cada cambio en el dispositivo se guarda como una operación en la **bandeja de salida** (id único, dispositivo, usuario, versión base, campos cambiados).
2. Al volver la señal, el dispositivo envía las operaciones y recibe los cambios de los demás.
3. El servidor aplica cada operación **una sola vez** (id de operación registrado en Valkey) y bajo un candado por paciente.
4. Si un campo cambió en el servidor desde la versión base y el valor es distinto, se crea un **conflicto**: se conserva el valor del servidor y una persona elige cuál queda (administración si el campo no es clínico; consulta clínica si lo es).
5. Si dos dispositivos dieron de alta a la misma persona sin señal, el servidor corre la búsqueda de coincidencias y abre un **posible duplicado** para administración.
6. Los dispositivos conectados reciben un aviso de "hay cambios" y se actualizan solos.

### 6.6 Administración

- Bandeja de posibles duplicados: ver ambos expedientes lado a lado, **vincular** o **descartar**.
- Bandeja de conflictos de sincronización: elegir valor.
- Bitácora consultable por paciente (muestra qué campo cambió, no su valor clínico).
- Tablero simple: pacientes registradas por jornada, visitas recurrentes detectadas, duplicados evitados, operaciones pendientes por dispositivo.

### 6.7 Importación masiva y agentes de IA (con internet)

EIRA ya tiene registros en Excel. Tres entradas llevan esos datos al expediente, **siempre por la misma revisión humana**:

1. **Plantilla de Excel:** se descarga desde la app (`/intake/import`). Sus columnas son los campos de identificación de `plantillas/mamaria.json` con etiquetas en español y una hoja de instrucciones. Sirve para capturar en Excel cuando no hay app a la mano.
2. **Subir un Excel o CSV:** la plantilla llena o un Excel existente de EIRA. Si las columnas no son las de la plantilla, el sistema propone a qué campo corresponde cada columna y una persona confirma el mapeo.
3. **Servidor MCP:** un agente de IA (por ejemplo Devin o Claude, con la suscripción del equipo) puede leer un Excel desordenado, normalizarlo y **proponer** las altas a través de herramientas MCP. Esto aprovecha a los agentes para el trabajo repetitivo de limpiar datos.

Las tres entradas crean un **lote de importación** y nada más:

- Cada fila se valida (campos obligatorios, fechas, formato del ID) y pasa por la misma búsqueda de coincidencias (6.2).
- Cada fila queda como `NEW` (sin coincidencias), `POSSIBLE_MATCH` (con candidatas y motivos) o `INVALID` (con el motivo en lenguaje sencillo).
- Captura revisa el lote: confirma altas, elige "Es ella" para agregar la visita al expediente existente, o descarta la fila. **Nada se guarda sin esa confirmación**; las filas confirmadas entran por el mismo camino de escritura que el resto (operaciones de sincronización).

Herramientas MCP (endpoint `/mcp`, transporte HTTP):

| Herramienta | Qué hace |
|---|---|
| `get_import_template` | Devuelve las columnas esperadas y sus reglas |
| `propose_import` | Recibe filas normalizadas y crea un lote pendiente de revisión |
| `get_import_status` | Estado de un lote: filas nuevas, posibles coincidencias, inválidas, confirmadas |

Límites del MCP:

- Ninguna herramienta puede confirmar, vincular, fusionar ni borrar. Solo proponer.
- Solo campos de identificación. Ninguna herramienta lee ni recibe datos clínicos.
- Cada agente usa un token propio con rol `intake`, emitido por administración y revocable; cada llamada queda en bitácora como `agent:<nombre del token>`.
- La búsqueda de pacientes no se expone por MCP: evita que un agente consulte expedientes; las coincidencias se calculan en el servidor y solo las ve captura al revisar el lote.
- Enviar datos de pacientes a un servicio de IA externo es una transferencia de datos personales: en el prototipo solo hay datos ficticios; en un piloto requiere aviso de privacidad, contrato con el proveedor y revisión legal.

### 6.8 Requisito: hasta 3 días sin conexión

Una jornada puede pasar **hasta 3 días sin internet**. Por eso:

1. **Sesión sin red:** al entrar con señal, el dispositivo guarda una sesión válida por 4 días. Sin red se desbloquea con un PIN del personal. El rol se aplica en el dispositivo y **el servidor lo vuelve a validar al sincronizar**: rechaza operaciones de un usuario sin permiso.
2. **Paquete de jornada vigente 7 días**, descargado antes de salir.
3. **Identificar no depende del OCR:** sin señal, captura teclea nombre y fecha de nacimiento para buscar; la foto del formato se guarda y se lee al volver la señal.
4. **Fotos comprimidas** en el dispositivo (lado mayor de 1600 px, JPEG) para que 3 días de jornada quepan sin problema.
5. **Idempotencia durable:** el id de cada operación se guarda con restricción única en la base de datos; Valkey es la vía rápida, no la única defensa (Valkey corre sin persistencia en desarrollo).
6. **Más duplicados entre dispositivos:** con 3 días sin red, dos tabletas pueden registrar a la misma persona. Se detecta al sincronizar y va a la bandeja de posibles duplicados.
7. **Respaldo:** el formato en papel sigue siendo el respaldo si un dispositivo se pierde antes de sincronizar. El indicador muestra cuántas operaciones y fotos faltan por sincronizar y desde cuándo.
8. Las versiones por campo, no la hora del dispositivo, deciden los conflictos (el reloj de una tableta puede estar mal).

## 7. Pantallas

| Ruta | Rol | Contenido |
|---|---|---|
| `/` | todos | Entrada a la app; indicador "Con señal / Sin señal" y operaciones pendientes |
| `/login` | personal | Usuarios de demostración |
| `/intake` | captura | Buscar o registrar paciente |
| `/intake/scan` | captura | Foto del formato y confirmación de campos |
| `/intake/import` | captura | Descargar plantilla de Excel, subir Excel o CSV, revisar lotes (incluidos los propuestos por agentes) |
| `/patients` | captura, clínica | Buscar expediente (pantalla de inicio de consulta clínica) |
| `/patients/[id]` | captura, clínica | Expediente: datos, historial de visitas y servicios (lo clínico solo para clínica) |
| `/patients/[id]/visit` | captura | Nueva visita y servicios |
| `/admin/matches` | administración | Posibles duplicados |
| `/admin/conflicts` | administración | Conflictos de sincronización |
| `/admin/audit` | administración | Bitácora y tablero |
| `/campaigns` | administración, captura | Jornadas y descarga del paquete |

## 8. API

```
POST /api/auth/login                 público     usuario demo -> sesión
GET  /api/campaigns/[id]/package     captura     paquete de jornada (índice mínimo)
GET  /api/patients/search            personal    coincidencias con puntaje y motivos
GET  /api/patients/[id]              personal    expediente (campos según rol)
POST /api/sync/push                  personal    operaciones de la bandeja de salida
GET  /api/sync/pull?cursor=          personal    cambios desde el cursor
POST /api/campaigns                  admin       crear jornada
POST /api/scans                      captura     imagen -> lectura propuesta
GET  /api/scans?status=              personal    formatos en cola o por confirmar (campos según rol)
POST /api/scans/[id]/confirm         captura, clínica  confirmar campos (identificación o clínicos, según rol)
POST /api/matches/[id]/link          admin       vincular expedientes
POST /api/matches/[id]/dismiss       admin       descartar posible duplicado
POST /api/conflicts/[id]/resolve     admin, clínica    elegir valor (según si el campo es clínico)
GET  /api/audit?patientId=           admin       bitácora
GET  /api/imports/template           captura     plantilla de Excel (.xlsx)
POST /api/imports                    captura     subir Excel o CSV -> lote con filas validadas y coincidencias
GET  /api/imports/[id]               captura     lote y sus filas
POST /api/imports/[id]/mapping       captura     confirmar mapeo de columnas
POST /api/imports/[id]/rows/[row]    captura     confirmar alta, "Es ella" o descartar
POST /api/agent-tokens               admin       emitir o revocar token de agente
POST /mcp                            agente      servidor MCP (token de agente)
```

Toda ruta valida rol en el servidor y escribe en bitácora.

Altas y cambios de pacientes, visitas y servicios entran **solo** por `/api/sync/push`, con o sin señal. Un solo camino de escritura evita que el modo en línea y el modo sin conexión se comporten distinto. Los usuarios del personal se siembran (demo); su administración queda fuera del prototipo.

## 9. Arquitectura y tecnología

Un solo repositorio en TypeScript con espacios de trabajo de npm:

```
apps/web        React + Vite + Tailwind, PWA instalable (vite-plugin-pwa), Dexie (IndexedDB)
apps/server     Hono sobre Node, Prisma, Valkey, Textract, S3
packages/shared tipos, esquemas de validación (zod), reglas de coincidencia y de versiones
```

- **App:** React + Vite + Tailwind como **PWA instalable**. Toda la app se guarda en el dispositivo y abre igual con o sin red. Opcional: empaquetar con Capacitor para Android.
- **Datos locales:** IndexedDB (Dexie) con pacientes del paquete, visitas, servicios, bandeja de salida y fotos en cola.
- **Servidor:** Hono sobre Node; Prisma + SQLite en desarrollo (PostgreSQL en piloto). El cliente tipado de Hono comparte los tipos de la API con la app.
- **Reglas compartidas:** la búsqueda de coincidencias y la detección de conflictos viven en `packages/shared` y corren igual en el dispositivo (sin red) y en el servidor (al sincronizar).
- **Valkey (patrocinador):** sesiones, ids de operación ya aplicados (sincronización idempotente), candado por paciente al aplicar cambios, límite de intentos en login y búsqueda, cola de lectura de formatos y pub/sub para avisar a los dispositivos conectados.
- **AWS:** Textract para leer formatos; S3 con cifrado en reposo para las imágenes; despliegue en EC2 con Docker Compose (app + Valkey) detrás de HTTPS.
- **Modos locales:** `OCR_MODE=mock` y `STORAGE_MODE=local` permiten correr todo sin cuenta de AWS.

### 9.1 Limitaciones de la PWA y cómo se mitigan

| Limitación | Mitigación en el prototipo | Para un piloto |
|---|---|---|
| La primera carga necesita internet y HTTPS (o `localhost`); sin HTTPS no hay service worker ni cámara | Instalar la app y descargar el paquete antes de salir | Lista de verificación de salida a jornada |
| El navegador puede borrar los datos guardados: Safari borra los datos de sitios no usados en 7 días si la app no está instalada en la pantalla de inicio; Chrome puede borrarlos si falta espacio | Pedir almacenamiento persistente (`navigator.storage.persist()`), usar la app instalada, tabletas Android | Evaluar Capacitor (SQLite nativo) si se pierden datos |
| Sin sincronización en segundo plano en iPad/iPhone: solo sincroniza con la app abierta | Sincronizar al abrir la app y al detectar señal; indicador de pendientes siempre visible | Recordatorio al personal al volver a zona con señal |
| Borrar datos del navegador o desinstalar la app borra lo no sincronizado | Aviso antes de cerrar sesión con pendientes; el formato en papel es el respaldo | Exportar respaldo cifrado a archivo |
| IndexedDB no está cifrado por defecto | Bloqueo de pantalla del dispositivo y paquete mínimo de jornada | Cifrar datos locales con PIN (WebCrypto) |
| La cámara web tiene menos control que una nativa (enfoque, recorte del documento) | Foto con la cámara del sistema (`<input capture>`) y compresión | Recorte automático del documento |
| Una tableta no puede pasar datos a otra sin internet (no hay Bluetooth ni red local para la web) | Duplicados entre tabletas se resuelven al sincronizar | App nativa con Capacitor para sincronizar en red local |
| Una versión nueva de la app solo llega con señal; en campo puede quedar una versión vieja | Cada operación lleva versión de esquema y el servidor acepta la anterior | No publicar cambios incompatibles durante una jornada |
| Espacio limitado por el navegador (Chrome: hasta cerca del 60 % del disco; Safari: menos) | Fotos comprimidas; 3 días de jornada caben sin problema | Medir con jornadas reales |

## 10. Accesibilidad y uso

- Pensado para celular o tableta en campo: botones grandes, texto de 18 px o más, un paso por pantalla en captura.
- Indicador siempre visible de señal y de operaciones pendientes.
- Mensajes de error que dicen qué hacer, no qué falló.
- Contraste AA.

## 11. Implementado y simulado

La tabla vigente vive en el `README.md` y se actualiza al cierre. Objetivo del día:

- **Implementado:** alta, búsqueda de coincidencias con confirmación, segunda visita con historial, trabajo sin conexión con sincronización y conflictos, roles en servidor y bitácora.
- **Implementado:** plantilla de Excel e importación de Excel o CSV con revisión humana.
- **Implementado si da el tiempo:** servidor MCP para agentes (Devin, Claude); digitalización con Textract; si no, Textract en modo `mock` y declarado.
- **Simulado:** usuarios del personal (demo), lectura de formatos en modo `mock`.
- **Solo documentado:** app para que la paciente revise sus propios datos, cifrado de datos locales con PIN, Cognito, otras plantillas de formato.
