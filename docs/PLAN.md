# Plan de construcción (sábado 21 de noviembre, hora de CDMX)

Reto 1: expediente digital único y registro de pacientes. Entrega en Devpost: **16:00**. Meta propia: enviar a las **15:45**. Después de las **14:30 no entra ninguna función nueva** que no esté aquí.

| Hora | Bloque | Se da por terminado cuando |
|---|---|---|
| 11:15-11:45 | **0. Base.** Monorepo (`apps/web` React + Vite PWA, `apps/server` Hono + Prisma + Valkey, `packages/shared`), modelo de datos, semilla, entrada del personal con roles demo (servidor), bitácora | Entro como captura, clínica y administración y veo pantallas distintas; la semilla crea 8 pacientes con visitas previas |
| 11:45-12:15 | **1. Registro y coincidencias.** Alta, búsqueda con puntaje y motivos, "Es ella / Es otra persona", nueva visita, expediente con historial | Busco a una paciente sembrada con el nombre sin acento: aparece con sus motivos; registro su segunda visita y veo el historial |
| 12:15-13:00 | **2. Sin conexión y sincronización.** Paquete de jornada en IndexedDB, bandeja de salida, service worker, push/pull con id de operación en Valkey, conflictos y posibles duplicados | En modo avión registro una paciente y una visita; al volver la señal se sincronizan y aparecen en otro navegador |
| 13:00-13:45 | **2b. Especialistas y pasos de la visita.** Roles `nutritionist`, `doctor`, `pathologist` (reemplazan a `clinician`), `filledBy` en plantillas, `VisitStep`, "con quién pasará" al registrar, "Pacientes esperándome", pantalla de mi paso, validación por campo en servidor | Registro una visita con nutriólogo y médico; cada uno la ve en su lista, llena solo sus campos y la visita queda completa |
| 13:45-14:35 | **3. Digitalización: foto y Excel.** Foto del formato con lectura `mock` (Textract si está listo) y confirmación; plantilla de Excel, subir Excel/CSV, lote con filas `NEW` / `POSSIBLE_MATCH` / `INVALID` y revisión humana | Subo un Excel con 5 filas: 3 nuevas, 1 posible coincidencia y 1 inválida; confirmo y aparecen en el expediente |
| 14:35-15:05 | **4. Agentes y administración.** Servidor MCP (`get_import_template`, `propose_import`, `get_import_status`) con token de agente; bandejas de duplicados y conflictos; bitácora por paciente | Un agente (Devin o Claude) propone un lote por MCP y aparece en `/intake/import` pendiente de revisión; vinculo un duplicado creado sin señal |
| 15:05-15:30 | **5. Pulido y despliegue.** Textos, estados vacíos, indicador de señal; despliegue en EC2 si está a un paso | El flujo completo corre dos veces seguidas sin errores |
| 15:30-15:45 | **6. Entrega.** README final, tabla implementado/simulado, video/capturas, Devpost, ensayo del pitch | Enviado en Devpost |

La comida (13:30-14:30) se cruza con los bloques 2 y 3: el agente avanza solo y se revisa al regresar.

## Orden de recorte si falta tiempo

1. Despliegue en AWS (demo en local; para el celular, túnel HTTPS temporal).
2. Empaquetado con Capacitor (quedarse en PWA instalable).
3. Textract (quedarse en `mock` y declararlo).
4. Pub/sub de "hay cambios" (refrescar a mano tras sincronizar).
5. Mapeo de columnas de un Excel ajeno (aceptar solo la plantilla propia).
6. Tablero de administración (dejar solo bandejas y bitácora).
7. Servidor MCP (dejarlo documentado; el Excel cubre la importación).

Lo que no se recorta: bloques 1 y 2 completos, roles en servidor y bitácora. Es lo que el reto pide demostrar.

## Despliegue (elige el camino más corto que funcione)

- **Plan A, una sola máquina:** EC2 chica con Docker Compose (app + Valkey) y un proxy con HTTPS automático. Imágenes en S3 con cifrado en reposo.
- **Plan B, demo local:** app en la laptop; el modo sin conexión funciona en `localhost`. Para el celular hace falta HTTPS (túnel temporal).
- HTTPS es obligatorio fuera de localhost: el service worker y la cámara no funcionan sin él.

## Pruebas manuales antes de entregar

- [ ] Una búsqueda solo por nombre nunca se marca como coincidencia fuerte.
- [ ] Nada se vincula sin pulsar "Es ella" o "Vincular".
- [ ] Vincular no borra ningún registro; el historial aparece unido.
- [ ] En modo avión se registran paciente, visita y servicio; al volver la señal se sincronizan.
- [ ] Reenviar la misma operación no la duplica.
- [ ] El mismo campo editado en dos dispositivos crea un conflicto, no se pisa.
- [ ] Dos altas sin señal de la misma persona abren un posible duplicado.
- [ ] Captura no ve resultados clínicos; captura no puede vincular (la API responde 403).
- [ ] Los campos leídos del formato no se guardan sin confirmar.
- [ ] La bitácora muestra todo el recorrido de una paciente.
- [ ] Un Excel subido no crea ningún expediente hasta que captura confirma cada fila.
- [ ] Ninguna herramienta MCP puede confirmar, vincular ni leer datos clínicos; un token revocado responde 401.
