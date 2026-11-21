# Huella Rosa: guía para el agente de código

Proyecto de hackathon (Nerdearla Vibeathon México 2026, reto 1 de EIRA: expediente digital único y registro de pacientes con conectividad intermitente). Lee `docs/SPEC.md` antes de escribir código y sigue `docs/PLAN.md` en orden. Una sola persona revisa tu trabajo: entrega pasos chicos que se puedan probar en el navegador.

## Reglas que no puedes romper

1. Solo datos ficticios. Nunca pidas ni uses datos reales. Los nombres pueden ser realistas (comunes, combinados al azar), pero teléfonos (55-0000-00XX), ID (`DEMO…`) y localidades se mantienen claramente ficticios para que ningún registro corresponda a una persona real.
2. Cada paciente tiene un identificador interno estable (UUID creado en el dispositivo). El nombre nunca es llave ni criterio único de coincidencia.
3. Nada se vincula ni se fusiona sin confirmación humana explícita. Vincular conserva ambos registros; nunca se borra un expediente.
4. La lectura de formatos (OCR) solo propone valores de los campos definidos en `plantillas/*.json`. No uses modelos generativos para interpretar, resumir o redactar datos clínicos. Todo valor leído se confirma antes de guardarse.
5. El texto clínico escrito a mano marcado como `no_transcribir` en la plantilla no se transcribe; se conserva la imagen.
6. Todo cambio escribe en bitácora (quién, qué, cuándo, dispositivo, entidad).
7. La validación de rol va en el servidor, no solo en la interfaz. Captura no ve datos clínicos de visitas anteriores.
8. La sincronización nunca pisa datos en silencio: un mismo campo cambiado en dos lados crea un conflicto.
9. No agregues funciones fuera de `docs/SPEC.md` sin que te lo pidan.

## Stack

- Monorepo con espacios de trabajo de npm, todo en TypeScript:
  - `apps/web`: React + Vite + Tailwind, PWA instalable con `vite-plugin-pwa`. Toda pantalla de captura lee y escribe en IndexedDB (Dexie), nunca directo a la API. Opcional: Capacitor para Android.
  - `apps/server`: Hono sobre Node (`@hono/node-server`), Prisma + SQLite en desarrollo.
  - `packages/shared`: tipos, esquemas zod, reglas de coincidencia y de conflictos. Lo que corre sin red y en el servidor se escribe una sola vez aquí.
- La app llama al servidor con el cliente tipado de Hono (`hc`). En desarrollo Vite redirige `/api` al servidor.
- Requisito de hasta 3 días sin internet: ver `docs/SPEC.md` sección 6.8 y limitaciones de la PWA en 9.1.
- Importación de Excel y servidor MCP para agentes de IA: `docs/SPEC.md` sección 6.7. El MCP solo propone lotes; nunca confirma, vincula ni toca datos clínicos.
- AWS: todo lo que toque AWS se hace con el **AWS Agent Toolkit** (MCP `aws-mcp` y las skills de AWS instaladas), nunca con scripts o SDK sueltos fuera de la app. Ninguna llamada a una cuenta real sin autorización explícita para esa operación.
- Servidor MCP para agentes de IA: `apps/mcp` con **FastMCP** (TypeScript, `fastmcp`), transporte HTTP en streaming; llama a la API del servidor con el token de agente.
- Valkey (patrocinador): sesiones, ids de operación aplicados (sincronización idempotente), candado por paciente, límite de intentos, cola de lectura de formatos y pub/sub de cambios. Cliente `iovalkey`.
- Lectura de formatos por `OCR_MODE`: `mock` (lee `datos-ficticios/formatos/*.json`) o `textract` (AWS Textract). Construye primero `mock`.
- Almacenamiento de imágenes por `STORAGE_MODE`: `local` o `s3`.
- Fija Prisma en la versión 6 (la etiqueta `latest` apunta a una versión de prueba de la 8). Antes de usar una API de una librería, revisa su documentación vigente.

## Idioma

Regla general: **el código y la estructura del proyecto van en inglés; lo que ve la persona usuaria va en español.**

| En inglés | En español de México |
|---|---|
| Nombres de archivos y carpetas en `apps/`, `packages/` y `scripts/` | Textos de la interfaz: etiquetas, botones, títulos, mensajes de error |
| Variables, funciones, tipos, componentes, modelos y campos de Prisma | Contenido de `plantillas/mensajes.json` y etiquetas de las plantillas |
| Valores de catálogos (roles, estados, tipos de servicio) | Etiquetas visibles de esos catálogos (mapa de valor a texto) |
| Rutas de páginas y de API, claves de Valkey, nombres de cookies | |
| Claves (`clave`) de `plantillas/*.json` | |
| Comentarios en el código, tests, commits, variables de entorno | Documentación del repo (`README.md`, `docs/`) |

- Los textos visibles no se escriben sueltos en los componentes; se centralizan en `apps/web/src/i18n/es.ts`.
- Las carpetas con nombre en español que ya existen (`plantillas/`, `datos-ficticios/`) se conservan.

### Glosario (SPEC en español → código en inglés)

| SPEC | Código |
|---|---|
| Paciente, Visita, Servicio, Jornada, Localidad, Usuario | `Patient`, `Visit`, `Service`, `Campaign`, `Locality`, `User` |
| Posible duplicado, Conflicto de sincronización, Formato digitalizado, Bitácora | `MatchReview`, `SyncConflict`, `FormScan`, `AuditLog` |
| Paquete de jornada, Bandeja de salida, Operación | `campaign package`, `outbox`, `op` (`SyncOp`) |
| Vincular, Descartar, "Es ella", "Es otra persona" | `link`, `dismiss`, `confirmMatch`, `rejectMatch` |
| Roles: captura, administración | `intake`, `admin` |
| Consulta clínica = nutriólogo, médico, patólogo | `nutritionist`, `doctor`, `pathologist` (grupo `CLINICAL_ROLES`; reemplazan a `clinician`) |
| Paso de la visita, Pacientes esperándome, con quién pasará | `VisitStep`, `queue`, `plannedSteps` |
| Servicios: revisión mamaria, ultrasonido, papanicolaou, mastografía | `BREAST_REVIEW`, `ULTRASOUND`, `PAP`, `MAMMOGRAPHY` |
| Nombre, fecha de nacimiento, entidad de nacimiento, "4. ID", "Folio Eira", residencia, afiliación | `fullName`, `birthDate`, `birthState`, `formId`, `folio`, `residence`, `affiliation` |
| Con señal / Sin señal | `online` / `offline` |
| Lote de importación, fila, token de agente, plantilla de Excel | `ImportBatch`, `ImportRow`, `AgentToken`, `import template` |

Si aparece un término que no está aquí, agrégalo a esta tabla antes de usarlo.

Nombre del producto: **Huella Rosa** (lema: "Una mujer, una huella, un solo expediente, con o sin señal"). En pantalla, la palabra "huella" se reserva para el nombre; la huella SHA-256 del teléfono (`phoneHash`) nunca se menciona en la interfaz.

## Convenciones

- **Todo lo visual se diseña y se consulta en Figma** (MCP de Figma): https://www.figma.com/design/4wgHGSiieY7oiIIFnGAjru. Antes de construir o cambiar una pantalla, revisa su marco en Figma; si la pantalla no existe ahí, diséñala primero en Figma. Colores de EIRA (de `eiraac.org/css/main.css`) como variables; sus componentes no se copian.
- Interfaz y mensajes en español de México, lenguaje sencillo.
- **Sin lenguaje de sistema en pantalla.** Nunca mostrar: servidor, versión, sincronización/sincronizar, conflicto, operación, duplicado, ID interno, estados en inglés. Decir qué pasó y qué hacer, con personas y horas:
  - "Conflicto de sincronización" → "Dos personas cambiaron el mismo dato".
  - "Valor en el servidor (versión 4)" → "Lo que ya estaba guardado · Diego, 19 nov 17:29"; "Valor de la tableta" → "Lo que capturó Guadalupe sin señal · 20 nov 12:10".
  - "Posible duplicado" → "¿Es la misma persona?"; "Registro A/B" → "Registrada por Guadalupe · 20 nov 11:05".
  - "N cambios por sincronizar" → "N cambios por enviar"; "Todo sincronizado" → "Todo enviado · 13:05"; "Sincronizar ahora" → "Enviar ahora".
  - Resultado al guardar: un solo "Guardado ✓"; solo se avisa cuando algo necesita atención ("Esperando a que llegue la visita", "Alguien más cambió este dato: lo revisará administración").
  - Diferencias: resaltarlas una vez con una leyenda, no repetir "Distinto" en cada fila.
- Pantallas de captura en campo: texto de 18 px o más, un paso por pantalla, botones grandes, indicador de señal y de operaciones pendientes siempre visible.
- Fechas clínicas como `AAAA-MM-DD` en texto para evitar problemas de zona horaria.
- Script `npm run seed` que crea usuarios demo, localidades, una jornada, pacientes con historial y casi-duplicados, y los formatos ficticios descritos en `datos-ficticios/README.md`.
- Sin secretos en el repo. Variables en `.env` (ver `.env.example`).

## Cómo trabajar

- Antes de cada bloque de `docs/PLAN.md`, di en una línea qué vas a construir. Al terminar, di cómo probarlo a mano.
- Si algo del plan no cabe en su tiempo, propón el recorte en vez de alargarlo.
- Mantén al día la tabla "Implementado y simulado" del `README.md`.
- Commits pequeños con mensaje en inglés (Conventional Commits).

## Comandos (complétalos al crear el proyecto)

```
docker compose up -d      # Valkey
npm install
npm run db:migrate        # Prisma en apps/server
npm run seed
npm run dev               # web :5173 + server :3001
```

## Contexto útil

- Investigación previa (solo lectura, no es parte del proyecto): `../vibeathon-mexico-2026-research/`.
- Fotos del formato de revisión mamaria de EIRA: solo como referencia de campos; no se suben al repo.
- Criterios del jurado: usabilidad, impacto, escalabilidad, privacidad y confianza, innovación, y que el flujo crítico funcione de punta a punta.
