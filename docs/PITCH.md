# Pitch de 3 minutos

Regla: mostrar el producto funcionando. Una idea por bloque. Ensayar dos veces con cronómetro.

## Guion

**0:00-0:25 Problema**
"En cada jornada, EIRA llena formatos en papel y el mismo día los vuelve a capturar en Excel. Trabajo doble. La paciente se identifica por su nombre: si viene cuatro veces en un año, queda registrada cuatro veces y su historial se parte. Y en la sierra no hay señal. Huella Rosa resuelve tres cosas: una paciente, un expediente; reconocer a quien regresa; y trabajar sin internet."

**0:25-0:55 Alta sin señal** (celular en modo avión)
Indicador en "Sin señal". Doy de alta a una paciente nueva: nombre, fecha de nacimiento, localidad. Se guarda en el dispositivo con su identificador propio. El contador dice "1 cambio por enviar".

**0:55-1:35 Segunda visita** (celular)
Llega otra paciente. Escribo su nombre sin acento y su fecha de nacimiento. El sistema propone una coincidencia y explica por qué: "misma fecha de nacimiento", "nombre parecido". Toco "Es ella" y aparece su historial de la jornada anterior. Actualizo solo su teléfono. "El sistema propone; una persona decide. Nunca se fusiona en automático."

**1:35-2:05 Del papel al expediente** (foto del formato)
Tomo foto del formato de revisión mamaria. Del lado izquierdo, el original; del derecho, los campos propuestos. Uno sale en amarillo: baja confianza. Lo corrijo viendo la imagen y confirmo. "La lectura no interpreta ni diagnostica: lo escrito a mano por la médica se guarda como imagen."

**2:05-2:35 Vuelve la señal** (laptop en administración)
Quito el modo avión. Los cambios se envían una sola vez. Otro dispositivo había cambiado el mismo teléfono: aparece un conflicto y administración elige cuál queda. Un alta repetida en dos dispositivos llega a la bandeja de posibles duplicados: las veo lado a lado y vinculo. Ningún dato se borra; todo queda en bitácora.

**2:35-3:00 Cierre** (tablero)
"Usabilidad: un paso por pantalla, pensado para el celular en campo. Impacto: menos captura doble y un historial completo por paciente. Escalabilidad: Valkey coordina la sincronización y AWS lee los formatos; agregar un formato es agregar un archivo. Privacidad y confianza: roles validados en el servidor y datos mínimos en el dispositivo. Innovación: reconocer a quien regresa, sin red y con una persona al mando. Es código abierto; los usuarios del personal son de demostración y la lectura de formatos está simulada. El siguiente paso es un piloto con una jornada."

## Preparación del demo

- Dos ventanas listas: celular o navegador móvil (captura) y laptop (administración y tablero).
- Datos sembrados y paquete de jornada ya descargado antes de subir al escenario.
- Un cambio preparado en otro dispositivo para provocar el conflicto.
- Tener el flujo grabado en video por si falla la red del lugar.
- Decir en voz alta qué es simulado: lo piden las bases.

## Texto para Devpost

- **Qué hace:** una frase por cada bloque del guion.
- **Cómo se construyó:** stack, uso de Valkey (sesiones, sincronización idempotente, candado por paciente, límite de intentos, cola de lectura de formatos, pub/sub), servicios de AWS (Textract, S3, EC2), agentes de código usados.
- **Implementado y simulado:** copiar la tabla del README.
- **Riesgos, costos y piloto:** copiar del README.
- **Preguntas abiertas para EIRA:** copiar del README.
- Repositorio público con licencia MIT y video o capturas.
