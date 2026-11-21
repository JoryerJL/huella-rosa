# Expediente Rosa: guía para el agente de código

Proyecto de hackathon (Nerdearla Vibeathon México 2026, reto 1 de EIRA: expediente digital único y registro de pacientes con conectividad intermitente). Lee `docs/SPEC.md` antes de escribir código y sigue `docs/PLAN.md` en orden. Una sola persona revisa tu trabajo: entrega pasos chicos que se puedan probar en el navegador.

## Reglas que no puedes romper

1. Solo datos ficticios. Nunca inventes datos que parezcan reales ni pidas datos reales.
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
| Roles: captura, consulta clínica, administración | `intake`, `clinician`, `admin` |
| Servicios: revisión mamaria, ultrasonido, papanicolaou, mastografía | `BREAST_REVIEW`, `ULTRASOUND`, `PAP`, `MAMMOGRAPHY` |
| Nombre, fecha de nacimiento, entidad de nacimiento, "4. ID", "Folio Eira", residencia, afiliación | `fullName`, `birthDate`, `birthState`, `formId`, `folio`, `residence`, `affiliation` |
| Con señal / Sin señal | `online` / `offline` |
| Lote de importación, fila, token de agente, plantilla de Excel | `ImportBatch`, `ImportRow`, `AgentToken`, `import template` |

Si aparece un término que no está aquí, agrégalo a esta tabla antes de usarlo.

## Convenciones

- Interfaz y mensajes en español de México, lenguaje sencillo.
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
