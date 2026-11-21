# Envío a Devpost: Huella Rosa

Borrador listo para pegar en el formulario de Devpost del Nerdearla Vibeathon by Devin (México, 21 de noviembre de 2026). **Cierre: 16:00 hora de Ciudad de México.**

> **Cómo se armó este borrador.** No hubo acceso al formulario con sesión iniciada (Claude in Chrome no estaba conectado), así que **no se leyó el formulario real**. Los campos marcados como **Confirmado** salen de las páginas públicas del hackathon ([inicio](https://vibeathon-mexico-2026.devpost.com/), [reglas](https://vibeathon-mexico-2026.devpost.com/rules), [recursos](https://vibeathon-mexico-2026.devpost.com/resources)). Los marcados como **Supuesto** son los campos estándar de Devpost: revísalos contra el formulario al pegar.

> **Estado del código.** El estado de cada función se tomó de la rama `main` al redactar. Antes de enviar, compara con la tabla "Implementado y simulado" del `README.md` y corrige lo que haya cambiado. No afirmes nada que no esté en `main`.

## 1. Campos del formulario

| Campo | ¿Obligatorio? | Límite | Origen | Estado de nuestra respuesta |
|---|---|---|---|---|
| Nombre del proyecto | Sí | ~60 caracteres (estándar de Devpost) | Supuesto | Listo (sección 2.1) |
| Elevator pitch / tagline | Sí | 200 caracteres | Supuesto | Listo, 177 caracteres (sección 2.2) |
| Imagen de portada (thumbnail) | No, pero recomendable | JPG, PNG o GIF, hasta 5 MB, proporción 3:2 | Supuesto | **Falta:** exportar desde Figma (sección 6) |
| Sobre el proyecto (historia, Markdown) | Sí | Sin límite práctico | Supuesto | Listo (sección 2.3) |
| Built with (etiquetas) | Sí | Etiquetas libres | Supuesto | Listo (sección 2.4) |
| Enlaces "Try it out" | No | URLs | Supuesto | Listo: repo y Figma (sección 2.5); sin URL pública desplegada |
| Galería de imágenes | No | JPG, PNG o GIF, hasta 5 MB c/u, 3:2 | Supuesto | **Falta:** capturas (sección 6) |
| Video demo | Requerido por las reglas ("Demo pitch, 2 minutos") | Enlace de YouTube, Vimeo o Youku (estándar de Devpost) | **Confirmado** (requisito 2) | **Falta:** grabarlo (sección 5) |
| Reto elegido | Sí | Pregunta del hackathon | **Confirmado** ("lo indica en el formulario de envío") | Listo: Reto 1 (sección 2.6) |
| Repositorio público con licencia open source | Sí | URL | **Confirmado** (requisito 3) | Listo: GitHub, licencia MIT |
| Integrantes del equipo | Sí | 1 a 4 personas; todas registradas en Nerdearla y en Devpost y añadidas al proyecto | **Confirmado** (requisito 1 y reglas) | **Falta:** confirmar registro (sección 6) |
| Otras preguntas del hackathon (país, aceptación de reglas, uso de herramientas) | Desconocido | Desconocido | Supuesto | **Revisar** al abrir el formulario |

## 2. Respuestas listas para pegar

### 2.1 Nombre del proyecto

```
Huella Rosa
```

### 2.2 Elevator pitch (177 de 200 caracteres)

```
Una mujer, una huella, un solo expediente, con o sin señal. Registro de pacientes para EIRA que reconoce a quien regresa y nunca une expedientes sin que una persona lo confirme.
```

### 2.3 Sobre el proyecto

Pega el bloque completo. Las partes entre corchetes se ajustan al estado real antes de enviar.

```markdown
## Inspiración

EIRA Movimiento Rosa lleva jornadas de detección de cáncer de mama y cervicouterino a comunidades de México. En cada jornada el personal llena formatos en papel y el mismo día los vuelve a capturar en Google Forms o Excel: trabajo doble y errores. La paciente se identifica por su nombre completo, así que una mujer que acude cuatro veces en un año puede quedar registrada cuatro veces y su historial se parte. Y las jornadas ocurren donde no hay señal estable, justo donde un sistema en línea deja de servir.

Elegimos el **Reto 1: expediente digital único y registro de pacientes**.

## Qué hace

- **Una paciente, un expediente.** Cada paciente recibe un identificador interno estable creado en el dispositivo, aun sin red. Visitas y servicios se registran por separado. El nombre nunca es la llave.
- **Reconoce a quien regresa.** Busca por varios atributos (nombre sin importar acentos, fecha y entidad de nacimiento, teléfono, localidad, ID del formato) y muestra candidatas con puntaje y motivos ("misma fecha de nacimiento", "nombre parecido"). Una persona decide: "Es ella" o "Es otra persona". Nunca se fusiona en automático.
- **Funciona sin internet.** El personal descarga el paquete de la jornada; después da de alta, registra visitas y cambia datos sin señal. Al volver la señal, los cambios se envían una sola vez. Si dos personas cambiaron el mismo dato, no se pisa: queda para que alguien decida. Dos altas de la misma persona hechas sin señal se marcan como posible duplicado.
- **Cada especialista ve su paso.** Al registrar la visita se indica con quién pasará la paciente (nutrición, medicina, patología). Cada especialista ve "Pacientes esperándome" y llena solo sus campos.
- **Roles y bitácora.** Captura, consulta clínica y administración, validados en el servidor. Captura no ve resultados clínicos de visitas anteriores. Cada cambio queda en bitácora: quién, qué, cuándo y desde qué dispositivo.
- [EN CONSTRUCCIÓN al redactar: foto del formato con lectura de campos y confirmación humana; importación de Excel/CSV con revisión fila por fila; bandejas de administración para vincular duplicados y resolver cambios cruzados. Quitar o mover a "Qué sigue" lo que no llegue a main.]

## Cómo lo construimos

- **App de campo:** React + Vite + Tailwind como PWA instalable (vite-plugin-pwa / Workbox). Todas las pantallas de captura leen y escriben en IndexedDB con Dexie, nunca directo a la API; una bandeja de salida guarda cada cambio como operación con id único, dispositivo, usuario y versión base.
- **Servidor:** Hono sobre Node con Prisma + SQLite. Valida rol en cada ruta y escribe la bitácora.
- **Reglas compartidas:** un paquete de TypeScript con esquemas zod, reglas de coincidencia y de conflictos; corre igual en el dispositivo sin red y en el servidor.
- **Valkey:** sesiones, ids de operación ya aplicados (envío idempotente), candado por paciente al aplicar cambios y límite de intentos de acceso. [Cola de lectura de formatos y avisos pub/sub: en construcción.]
- **Coincidencias deterministas, sin IA:** ID del formato igual, o misma fecha de nacimiento con nombre parecido o con el mismo teléfono, es coincidencia fuerte. Solo el nombre parecido es débil y nunca basta.
- **Datos mínimos en el dispositivo:** el paquete de jornada lleva solo lo necesario para reconocer a una paciente; el teléfono viaja como huella SHA-256, no en claro.
- **Plantillas JSON:** los campos de cada formato viven en `plantillas/*.json`; agregar un formato es agregar un archivo.
- **Diseño:** todas las pantallas se diseñaron primero en Figma con la paleta de EIRA, con texto de 18 px o más, un paso por pantalla y lenguaje sin términos de sistema ("3 cambios por enviar", "Dos personas cambiaron el mismo dato").
- **AWS (Textract y S3):** el código tiene modos `OCR_MODE=mock|textract` y `STORAGE_MODE=local|s3`. [En el demo corre en `mock` y `local`; Textract y S3 reales: en construcción.]
- **Agentes de código:** la idea se validó con **Devin**; la construcción se hizo con **Claude Code** como orquestador y trabajadores en paralelo (Orca) y **Codex** para logos e imágenes de prueba, en bloques chicos probados en el navegador antes de integrarse.

## Implementado y simulado

[Pegar aquí la tabla "Implementado y simulado" del README.md, ya actualizada.]

Simulado y declarado: usuarios del personal (de demostración) y lectura de formatos (modo `mock`). Solo documentado: app para que la paciente revise sus datos, cifrado local con PIN, Amazon Cognito con MFA y otras plantillas de formato.

## Retos

- Trabajar sin señal sin perder datos ni pisar cambios: resolvimos con operaciones idempotentes, versión por campo y candado por paciente, en lugar de "gana el último".
- Reconocer a una paciente sin usar el nombre como llave y sin fusionar en automático: el sistema propone y explica; una persona decide, y vincular conserva ambos registros.
- Mantener el lenguaje de la pantalla en términos de personas y horas, no de sistema, para que lo use alguien con pocas habilidades digitales.

## Logros

- El flujo crítico del reto (alta, coincidencia, segunda visita con historial, trabajo sin conexión y control de acceso) corre de punta a punta con datos ficticios.
- Las mismas reglas de coincidencia y conflictos corren en el dispositivo y en el servidor.
- Todo es código abierto (MIT) y corre en local sin cuentas externas.

## Qué aprendimos

- En campo, "sin conexión" no es un caso raro: es el caso normal, y hay que diseñar la app alrededor de una bandeja de salida.
- La confianza en datos de salud se gana con límites claros: datos mínimos, roles en el servidor, bitácora y una persona al mando de cada decisión.

## Qué sigue

- Validar con EIRA los campos del formato, las reglas de coincidencia, los roles y el aviso de privacidad.
- Piloto en una jornada y una localidad, con el papel en paralelo.
- Cognito con MFA, cifrado local con PIN y borrado remoto.
- Lectura con Textract, servidor MCP para que agentes de IA propongan lotes de altas (sin confirmar ni ver datos clínicos) y despliegue en AWS. [Mover aquí lo que siga en construcción.]

Riesgos, seguridad, operación, costos, pasos para un piloto y preguntas abiertas para EIRA: ver el README del repositorio.

**Prototipo con datos ficticios. No está autorizado para usarse con pacientes reales.**
```

### 2.4 Built with

Solo lo que ya está en `main`:

```
react, vite, typescript, tailwindcss, hono, node.js, prisma, sqlite, valkey, dexie, indexeddb, pwa, workbox, zod, figma
```

Herramientas de IA usadas en la jornada: `devin` (validación de la idea), `claude-code`, `codex`.

Agregar solo si llegan a `main` y se usan en el demo: `aws-textract`, `amazon-s3`, `amazon-ec2`, `fastmcp`.

### 2.5 Enlaces "Try it out"

```
https://github.com/JoryerJL/huella-rosa
https://www.figma.com/design/4wgHGSiieY7oiIIFnGAjru
```

- Revisa que el archivo de Figma tenga acceso "cualquiera con el enlace puede ver" antes de pegarlo.
- App en línea: https://huella-rosa.jjjl.dev (AWS us-east-1 con CDK, detrás de Cloudflare). Usuarios y recorridos para el jurado: `docs/JURADO.md`.

### Presentación

Presentación para EIRA en Figma Slides (17 diapositivas, contada como historia: "un día de jornada con Lucía" con capturas reales de la app; antes de salir, reconocimiento sin acentos, folio, estaciones sin señal, expediente completo, lo que gana EIRA, cuidado de las pacientes, cómo empezar un piloto y QR a la app; anexo técnico opcional al final):

```
https://www.figma.com/slides/nbtf2sijbXGQunfgwprzd7
```

- Revisa que tenga acceso "cualquiera con el enlace puede ver" antes de pegarla.

### 2.6 Reto elegido

```
Reto 1. Expediente digital único y registro de pacientes
```

## 3. Contenido obligatorio del hackathon

Las reglas dicen que las propuestas que no lo incluyan "no serán tenidas en cuenta por el jurado".

| Lo que piden (requisito 5) | Dónde está | Pendiente |
|---|---|---|
| Prototipo con datos ficticios que muestre de inicio a fin el caso de uso del reto | Código en el repo; `npm run seed` crea datos ficticios; recorrido en el video | Grabar el video (sección 5) |
| Explicación breve de arquitectura, tecnologías, dependencias y decisiones de diseño, distinguiendo implementado de simulado | `README.md`: "Arquitectura", "Decisiones de diseño", "Credenciales y servicios" e "Implementado y simulado"; resumen en "Cómo lo construimos" | **La tabla "Implementado y simulado" del README dice "Por construir" en casi todo** aunque los bloques 0, 1, 2 y 2b ya están en `main`. Actualizarla antes de enviar |
| Riesgos, seguridad, operación, costos y próximos pasos para un piloto real | `README.md`: "Riesgos y seguridad", "Operación y capacitación", "Costos y sostenibilidad", "Pasos para un piloto real" | "Guía de una página por rol" sigue pendiente; los costos son estimación sin validar (ya dice "decenas de dólares mensuales", sin cifra cerrada) |
| Preguntas abiertas y supuestos por validar con EIRA | `README.md`: "Preguntas abiertas y supuestos por validar con EIRA" | Completo |
| Repositorio público con licencia open source y README con cómo levantarlo y qué credenciales necesita | `LICENSE` (MIT); `README.md`: "Cómo levantar el proyecto" y "Credenciales y servicios" | Revisar que los comandos del README sigan funcionando en `main` |
| Demo pitch de 2 minutos | Video | **Grabar.** Ojo: `docs/PITCH.md` está escrito para 3 minutos; las reglas piden **2** |

## 4. Criterios del jurado

- **Usabilidad.** Pantallas de captura con texto de 18 px o más, un paso por pantalla y botones grandes, pensadas para celular en campo. El indicador de señal y de "cambios por enviar" siempre está a la vista, y la pantalla habla de personas y horas, no de sistema.
- **Impacto.** Ataca los dos dolores centrales: la captura doble y el historial partido. Reconocer a quien regresa por varios atributos evita que una mujer quede registrada cuatro veces, y cada especialista ve su paso en la visita.
- **Escalabilidad.** Agregar una jornada es descargar su paquete; agregar un formato es agregar un archivo JSON en `plantillas/`. Valkey coordina envíos de muchos dispositivos con idempotencia y candado por paciente, y Textract y S3 quedan detrás de un modo configurable.
- **Privacidad y confianza.** Roles validados en el servidor, captura sin acceso a resultados clínicos previos, paquete mínimo en el dispositivo (teléfono como huella SHA-256) y bitácora de cada cambio. Nada se fusiona sin confirmación humana y vincular nunca borra un registro.
- **Innovación.** Reconocimiento de pacientes recurrentes que funciona sin red y explica sus motivos, con una persona al mando. Los cambios cruzados se detectan campo por campo en vez de "gana el último".

## 5. Video demo de 2 minutos

Basado en `docs/PITCH.md`, recortado a 2 minutos. Muestra solo lo que está en `main` al grabar.

| Tiempo | Qué mostrar | Qué decir |
|---|---|---|
| 0:00-0:15 | Pantalla de entrada con el lema | Problema: captura doble, la paciente se identifica por nombre y en la sierra no hay señal |
| 0:15-0:40 | Celular o navegador en "Sin señal": alta de una paciente nueva; contador "1 cambio por enviar" | Se guarda en el dispositivo con su identificador propio |
| 0:40-1:10 | Búsqueda con el nombre sin acento: candidata con motivos; "Es ella"; historial; nueva visita con "con quién pasará" | "El sistema propone; una persona decide. Nunca se fusiona en automático." |
| 1:10-1:35 | Vuelve la señal: los cambios se envían; el mismo dato cambiado en dos lados queda para que alguien decida; especialista ve "Pacientes esperándome" | Envío una sola vez, nada se pisa, todo queda en bitácora |
| 1:35-2:00 | Cierre con roles (captura no ve resultados clínicos) | Los cinco criterios en una frase cada uno, y qué es simulado: usuarios de demostración y lectura de formatos en `mock` |

Si la foto del formato o las bandejas de administración llegan a `main` antes de grabar, reemplaza el bloque 1:10-1:35 por la parte que mejor funcione; no metas todo.

## 6. Pendientes que solo tú puedes hacer antes de las 16:00

- [ ] Actualizar la tabla "Implementado y simulado" del `README.md` con el estado real de `main` y hacer push.
- [ ] Grabar el video de 2 minutos (sección 5), subirlo a YouTube o Vimeo como "no listado" y pegar el enlace.
- [ ] Capturas para la galería (3:2, hasta 5 MB):
  - [ ] Portada: logo y lema de Huella Rosa (exportar de Figma).
  - [ ] Entrada del personal con el lema.
  - [ ] Búsqueda con candidata, puntaje y motivos.
  - [ ] Expediente con historial y nueva visita.
  - [ ] Indicador "Sin señal" con "N cambios por enviar".
  - [ ] "Pacientes esperándome" de un especialista.
  - [ ] "Dos personas cambiaron el mismo dato" (si la pantalla ya existe; si no, el marco de Figma marcado como diseño).
  - [ ] Diagrama de arquitectura (el bloque del README como imagen).
- [ ] Confirmar que cada integrante está registrado en Nerdearla y en Devpost y añadido al proyecto (hasta 4 personas).
- [ ] Ajustar en "Cómo lo construimos" qué agentes de código se usaron de verdad.
- [ ] Revisar que el enlace de Figma sea de solo lectura y público.
- [ ] Abrir el formulario y comparar con la tabla de la sección 1; responder las preguntas que no aparecen aquí.
- [ ] Pegar todo, revisar la vista previa y **enviar** (meta: 15:45).
