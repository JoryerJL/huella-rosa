## Inspiración

EIRA Movimiento Rosa lleva tamizaje de cáncer de mama y cervicouterino a comunidades donde casi nunca hay señal. En cada jornada el personal llena formatos en papel y esa misma noche los vuelve a capturar en Excel. La paciente se identifica por su nombre, así que una mujer que viene cuatro veces en un año puede quedar registrada cuatro veces, y nadie ve su historial completo.

Nos inspiró una idea sencilla: **cada mujer debería tener un solo expediente**, sin importar en qué jornada se atienda ni si hay internet ese día. De ahí el nombre: *Huella Rosa. Una mujer, una huella, un solo expediente, con o sin señal.*

## Qué hace

- **Identifica primero, registra después.** Antes de crear un registro, la app busca a la paciente por nombre, fecha de nacimiento y un dato más. Si escribieron "Lucia Ramirez" sin acentos, igual encuentra a *Lucía Ramírez Torres* y explica por qué ("misma fecha de nacimiento", "nombre parecido", "mismo teléfono"). Una persona confirma "Es ella". Nunca fusiona sola.
- **Funciona sin señal hasta 3 días.** Antes de salir, cada tableta descarga la jornada: las pacientes de esas comunidades con su identificación y su historial de visitas, sin resultados clínicos. Sin internet se busca, se registra y se atiende; al volver la señal todo se envía solo y se une sin duplicar.
- **El folio une a las estaciones sin internet.** La paciente pasa por nutrición, médico y patología, cada estación en su propia tableta. Captura escribe un folio corto en el formato en papel (por ejemplo `A8-001-B`) y cada especialista lo teclea. Su paso se une a la visita correcta cuando hay señal, aunque la visita todavía no haya llegado.
- **Cada quien ve y llena solo lo suyo.** Nutrición, la somatometría; médico, la consulta y el BIRADS; patología, la citología. Captura no ve resultados clínicos. El servidor lo valida.
- **Un expediente completo.** El ID EIRA, todas las visitas por jornada y folio, las estaciones por las que pasó, los resultados por estación (para el personal clínico) y quién hizo qué y cuándo.
- **Del papel al expediente.** Foto del formato con AWS Textract (lee solo la identificación y marca en ámbar lo dudoso) e importación de Excel con revisión fila por fila.
- **Un agente de IA importa por ti, tú decides.** Desde un agente como Devin o Claude, la persona entra con su cuenta de Huella Rosa, le pasa una foto o un Excel, el agente le muestra el plan y lo aplica solo cuando ella confirma.
- **Administración:** alta del personal y de jornadas, "¿Es la misma persona?" para revisar posibles duplicados, "Dos personas cambiaron el mismo dato" y una bitácora en lenguaje sencillo.

## Cómo lo construimos

Validamos la idea con **Devin** y la construimos en un día con **Claude Code** como orquestador de varios agentes trabajando en paralelo en **Orca**, cada uno en su propia rama de git, con integración a `main` solo después de probar. **Codex** generó propuestas de logo y fotos ficticias de formatos llenados a mano para probar el OCR. Todo lo visual se diseñó primero en **Figma** (por MCP), con la paleta de EIRA.

- **App:** React + Vite + Tailwind como PWA instalable, con Dexie (IndexedDB) para guardar la jornada en la tableta y una bandeja de cambios por enviar.
- **Servidor:** Hono sobre Node, Prisma + SQLite, validación de roles en cada ruta.
- **Valkey** (patrocinador): sesiones, límite de intentos, operaciones que se aplican una sola vez, candado por paciente al aplicar cambios y aviso en vivo a las tabletas conectadas (pub/sub).
- **AWS** con **CDK**: EC2, S3 cifrado y Textract, en us-east-1, detrás de un túnel de Cloudflare en `huella-rosa.jjjl.dev`. Un comando crea todo y otro lo borra.
- **Agentes de IA:** servidor MCP con **FastMCP** e inicio de sesión OAuth 2.1 + PKCE con la cuenta de la app.
- **Pruebas:** más de 180 pruebas automáticas y un recorrido completo grabado con Playwright (dos tabletas, con y sin señal) que también sirvió para los videos, hechos con **HyperFrames**.

La búsqueda de coincidencias es determinista, sin IA. La similitud de nombres compara conjuntos de palabras normalizadas (sin acentos, en cualquier orden):

$$
\text{sim}(A, B) = \frac{2\,|A \cap B|}{|A| + |B|}
$$

y una coincidencia es **fuerte** solo si

$$
\text{ID igual} \;\lor\; \big(\text{fecha igual} \land \text{sim} \ge 0.6\big) \;\lor\; \big(\text{teléfono igual} \land \text{fecha igual}\big).
$$

El nombre solo nunca basta. El teléfono viaja a la tableta únicamente como huella SHA-256, para comparar sin guardar el número.

## Retos

- **Identificar sin usar el nombre como llave.** Diseñamos un identificador interno estable creado en la tableta y reglas que proponen, nunca deciden.
- **Varias tabletas sin internet.** Una app web no puede pasar datos entre tabletas sin red. La solución fue el folio en el papel, más operaciones que, si llegan antes que la visita, quedan en espera y se reintentan. Valkey y la base de datos garantizan que nada se aplique dos veces.
- **El OCR y las fechas.** El formato divide la fecha en casillas de día, mes y año. En la primera prueba con 8 formatos ficticios, Textract leía todo menos las fechas (0 de 8). Tras corregir el mapeo: **46 de 48 datos correctos** y la paciente encontrada **solo con la foto en 7 de 8**.
- **Lenguaje sencillo.** Quitamos de la pantalla palabras como "servidor", "sincronizar" o "conflicto". La interfaz dice "Dos personas cambiaron el mismo dato" o "3 cambios por enviar".
- **Privacidad.** Ningún dato clínico viaja en el paquete de la tableta ni en los avisos, y cada rol ve solo lo suyo.

## Lo que aprendimos

- Que "sin internet" no es un modo extra: cambia todo el diseño, desde la identidad hasta cómo se escribe cada cambio.
- Que la mejor IA para datos de salud es la que **propone y explica**, con una persona que decide.
- Que orquestar varios agentes en paralelo funciona si cada uno tiene un contrato claro, su propia rama y pruebas antes de integrar.

## Lo que sigue

- Un piloto en una jornada real de EIRA, con el papel en paralelo.
- Validar con EIRA qué va en la casilla 11 del ID y los textos de los diagnósticos de citología.
- Mejorar el OCR con formatos reales escritos a mano (fotos inclinadas, datos vacíos en ámbar).
- Amazon Cognito con MFA para el personal y cifrado de los datos de la tableta con PIN.

> Prototipo de código abierto (MIT) con datos ficticios. Pruébalo en https://huella-rosa.jjjl.dev (guía y usuarios en `docs/JURADO.md`).
