# Expediente Rosa

**Una paciente, un expediente**, aunque se registre en jornadas distintas y **aunque no haya señal**.

Prototipo de código abierto para [EIRA Movimiento Rosa A.C.](https://www.eiraac.org), construido en el Nerdearla Vibeathon México 2026 (reto 1: expediente digital único y registro de pacientes, aun con conectividad intermitente).

> **Prototipo con datos ficticios.** No está autorizado para usarse con pacientes reales. Cualquier función clínica o uso con datos personales requiere revisión de EIRA.

## El problema

En cada jornada el personal llena formatos en papel, como el formato de revisión mamaria, y el mismo día los vuelve a capturar en Google Forms o Excel: trabajo doble y errores. La paciente se identifica por su nombre completo, así que una mujer que acude cuatro veces en un año puede quedar registrada cuatro veces y su historial se parte. Además, las jornadas ocurren en comunidades sin señal estable, justo donde un sistema en línea deja de funcionar.

## Qué hace

1. **Una paciente, un expediente.** Cada paciente recibe un identificador interno estable, creado en el dispositivo aun sin red. Visitas y servicios se registran por separado.
2. **Reconoce a quien regresa.** Busca por varios atributos (nombre, fecha de nacimiento, entidad de nacimiento, teléfono, localidad, ID del formato) y muestra candidatas con puntaje y motivos. **Una persona decide**: "Es ella" o "Es otra persona". Nunca se fusiona en automático.
3. **Funciona sin internet.** Todo se captura en el dispositivo y se sincroniza al volver la señal, con detección de conflictos campo por campo.
4. **Del papel al expediente.** Foto del formato, lectura de los campos y confirmación humana con el original a la vista. Sin señal, la foto espera en cola.
5. **Administración.** Bandeja de posibles duplicados (vincular o descartar), bandeja de conflictos, bitácora por paciente y tablero por jornada.

La especificación completa está en [`docs/SPEC.md`](docs/SPEC.md).

## Cómo levantar el proyecto

Requisitos: Node.js 20 o superior y Docker.

```bash
cp .env.example .env
docker compose up -d        # Valkey
npm install
npm run db:migrate          # Prisma (apps/server)
npm run seed                # usuarios demo, localidades, jornada, pacientes y formatos ficticios
npm run dev                 # app en http://localhost:5173, servidor en http://localhost:3001
```

Usuarios de demostración: se listan en la pantalla `/login` (captura, consulta clínica, administración).

Para probar el trabajo sin conexión: entra como captura, descarga el paquete de la jornada en `/campaigns` y pon el navegador sin red (modo avión o "Offline" en las herramientas de desarrollo).

### Credenciales y servicios

| Servicio | Para qué | ¿Obligatorio? |
|---|---|---|
| Valkey | Sesiones, sincronización idempotente, candado por paciente, límite de intentos, cola de lectura de formatos, avisos a dispositivos (pub/sub) | Sí (local con Docker) |
| AWS Textract | Leer formatos (formularios y casillas) | No. `OCR_MODE=mock` no usa red |
| AWS S3 | Guardar imágenes de formatos con cifrado en reposo | No. `STORAGE_MODE=local` usa disco |
| AWS EC2 | Despliegue con Docker Compose (app + Valkey) detrás de HTTPS | No, solo para desplegar |
| Credenciales de AWS | Solo si activas Textract o S3 | No |

No se necesita ninguna cuenta externa para correr el flujo completo en local.

## Arquitectura

```
Dispositivo de campo (React + Vite, PWA instalable, service worker)
  ├─ IndexedDB (Dexie) ... paquete de jornada, visitas, servicios, bandeja de salida, fotos en cola
  ├─ Captura ............. buscar, dar de alta, nueva visita, foto del formato
  ├─ Consulta clínica .... historial completo
  └─ Administración ...... duplicados, conflictos, bitácora, tablero
        │ HTTPS (cuando hay señal)
Servidor Hono sobre Node (rutas API con validación de rol y bitácora)
  ├─ packages/shared ..... reglas de coincidencia y conflictos (las mismas que en el dispositivo)
  ├─ Prisma + SQLite ..... pacientes, visitas, servicios, jornadas, posibles duplicados, conflictos, bitácora
  ├─ Valkey .............. sesiones, ids de operación aplicados, candado por paciente,
  │                        límite de intentos, cola de lectura, pub/sub
  ├─ Almacenamiento ...... disco local o S3 cifrado
  └─ Lectura de formatos . mock | Textract, según plantilla JSON
```

### Decisiones de diseño

- **Identificador interno estable (UUID) creado en el dispositivo.** Se puede dar de alta sin red. El nombre nunca es identificador ni criterio único.
- **Nunca fusionar en automático.** El sistema propone y explica; una persona decide. Vincular conserva ambos registros: el duplicado apunta al expediente principal y nada se borra.
- **Coincidencias con reglas deterministas, sin IA.** ID del formato igual, o fecha de nacimiento igual con nombre parecido o con el mismo teléfono, cuenta como coincidencia fuerte. Solo el nombre parecido es débil y nunca basta.
- **La lectura automática no interpreta.** Solo propone valores de campos definidos en `plantillas/*.json`. El texto clínico escrito a mano no se transcribe: se conserva la imagen.
- **Bandeja de salida con operaciones idempotentes.** Cada cambio lleva id único, dispositivo, usuario y versión base. El servidor lo aplica una sola vez y bajo un candado por paciente.
- **Conflictos campo por campo.** Si un dato cambió en el servidor y en el dispositivo, se conserva el del servidor y una persona elige cuál queda (administración en campos no clínicos, consulta clínica en clínicos). Deciden las versiones por campo, no la hora del dispositivo.
- **Paquete mínimo de jornada.** El dispositivo guarda solo lo necesario para buscar coincidencias: nombre, fecha y entidad de nacimiento, huella SHA-256 del teléfono, ID del formato y visitas previas sin datos clínicos.
- **Hasta 3 días sin internet.** Sesión de 4 días con desbloqueo por PIN, paquete vigente 7 días, fotos comprimidas e idempotencia guardada en la base de datos (no solo en Valkey).
- **PWA con React + Vite y servidor Hono.** La app completa vive en el dispositivo; las limitaciones de la PWA y sus mitigaciones están en `docs/SPEC.md` (sección 9.1).
- **Plantillas en JSON** (`plantillas/`). Agregar otro formato es agregar un archivo, no cambiar código.
- **Sin dependencia de red para el demo.** Cada servicio externo tiene un modo local.

## Implementado y simulado

> Actualizar esta tabla al cierre con el estado real.

| Función | Estado |
|---|---|
| Alta de paciente con identificador estable creado en el dispositivo | Por construir |
| Búsqueda de coincidencias con puntaje, motivos y confirmación humana | Por construir |
| Segunda visita con historial | Por construir |
| Captura sin conexión (IndexedDB) y bandeja de salida | Por construir |
| Sincronización idempotente con detección de conflictos (Valkey) | Por construir |
| Bandeja de posibles duplicados: vincular o descartar | Por construir |
| Bandeja de conflictos de sincronización | Por construir |
| Roles validados en el servidor y bitácora | **Implementado** para entrada y salida del personal (bloque 0); falta en las demás acciones |
| Plantilla de Excel e importación de Excel/CSV con revisión humana | Por construir |
| Servidor MCP para que agentes de IA (Devin, Claude) propongan lotes de altas | Por construir (si no da el tiempo, queda documentado) |
| Tablero por jornada | Por construir |
| Digitalización de formatos con AWS Textract | Por construir (si no da el tiempo, queda en modo `mock`, declarado) |
| Usuarios del personal | **Simulado** (usuarios de demostración) |
| Lectura de formatos | **Simulado** (`OCR_MODE=mock`) |
| App para que la paciente revise sus propios datos | **Solo documentado** |
| Cifrado de datos locales con PIN | **Solo documentado** |
| Amazon Cognito con MFA | **Solo documentado** |
| Otras plantillas de formato (por ejemplo, citología) | **Solo documentado** |

## Riesgos y seguridad

| Riesgo | Mitigación en el prototipo | Para un piloto |
|---|---|---|
| Vincular el expediente de otra persona | Nunca se fusiona en automático; confirmación humana con motivos a la vista; vincular conserva ambos registros y queda en bitácora | Revisión de duplicados por una persona designada; poder deshacer una vinculación |
| Dispositivo perdido con datos locales | Paquete mínimo de jornada, sin datos clínicos de visitas anteriores | Datos locales cifrados con PIN, borrado remoto, caducidad del paquete |
| Conflictos al sincronizar | Operaciones idempotentes, candado por paciente, detección campo por campo; se conserva el valor del servidor y administración decide | Medir conflictos por jornada y ajustar quién edita qué |
| OCR lee mal un formato | Confirmación humana con la imagen original; campos de baja confianza en amarillo; lo manuscrito clínico no se transcribe | Medir la tasa de correcciones por campo |
| Acceso indebido | Rol validado en el servidor, sesiones y límite de intentos en Valkey, bitácora de cada acción | Amazon Cognito con MFA, monitoreo |
| Datos de salud en la nube | Datos ficticios; cifrado en reposo (S3) y en tránsito (HTTPS) | Aviso de privacidad, contrato de tratamiento de datos, región y retención definidas con EIRA, revisión legal conforme a la normativa mexicana de datos personales |

Datos mínimos: captura no ve resultados clínicos de visitas anteriores; solo consulta clínica ve el historial completo. Toda acción queda en bitácora (quién, qué, cuándo, desde qué dispositivo).

## Operación y capacitación

- Pensado para celular o tableta en campo: botones grandes, texto de 18 px o más, un paso por pantalla en captura.
- Indicador siempre visible de señal y de cambios pendientes por enviar.
- Guía de una página por rol (pendiente).
- Respaldo en papel: si el dispositivo falla, se sigue con el formato en papel y se digitaliza después con la foto.

## Costos y sostenibilidad

- Todo el software es de código abierto (MIT) y las dependencias también lo son.
- Componentes con costo recurrente en un piloto: un servidor chico (EC2), almacenamiento de imágenes (S3) y lectura de formatos por página (Textract).
- Orden de magnitud esperado: **decenas de dólares mensuales**. Estimación sin validar: depende del número de formatos por jornada; calcular con la calculadora de precios de AWS antes de comprometer cifras.
- Sin Textract ni S3 el sistema funciona en un solo servidor; la captura se puede hacer a mano.

## Pasos para un piloto real

1. Revisión de EIRA: campos del formato, reglas de coincidencia, roles y aviso de privacidad.
2. Una jornada, una localidad, con el papel en paralelo.
3. Autenticación real del personal (Cognito con MFA) y alta controlada de dispositivos.
4. Datos locales cifrados con PIN y borrado remoto.
5. Medir: duplicados evitados, visitas recurrentes reconocidas, tiempo de captura por paciente, conflictos de sincronización y correcciones de OCR.
6. Revisión de seguridad independiente antes de ampliar.

## Preguntas abiertas y supuestos por validar con EIRA

- ¿Qué es el campo "4. ID" (11 casillas) del formato de revisión mamaria? ¿Es único de por vida?
- ¿Qué identifica el "Folio Eira": el formato, la visita o la paciente?
- ¿Qué es la Cartilla Eira y qué datos lleva?
- ¿Qué dispositivos usa el personal en campo (celular, tableta, sistema operativo)?
- ¿Cuántos dispositivos se usan por jornada?
- ¿Quién debe resolver los posibles duplicados?
- ¿Cuánto tiempo deben conservarse los datos y las imágenes de los formatos?
- Supuesto: el formato de revisión mamaria es el primero que conviene digitalizar.
- Supuesto: antes de cada jornada hay señal para descargar el paquete.

## Hoja de ruta

- App para que la paciente revise sus propios datos.
- Cifrado de datos locales con PIN y autenticación con Cognito.
- Otras plantillas de formato (citología, ultrasonido, mastografía).
- El mismo expediente permite entregar resultados de forma segura (reto 4).

## Licencia

[MIT](LICENSE). EIRA y Nerdearla pueden usar, adaptar y desplegar esta solución respetando la licencia y dando crédito.

## Autoría

Joryer Jiménez. Construido con asistentes de código durante la jornada del 21 de noviembre de 2026.
