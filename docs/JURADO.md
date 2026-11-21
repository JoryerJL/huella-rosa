# Cómo probar Huella Rosa (guía para el jurado)

**App en línea:** https://huella-rosa.jjjl.dev

Todo lo que hay en la app es **ficticio**: nombres, teléfonos (55-0000-00XX), IDs y localidades. Puedes crear, editar y registrar lo que quieras. Los datos se pueden restablecer en cualquier momento (ver el final).

Funciona mejor en Chrome, en computadora, tableta o celular. En el celular puedes instalarla: menú del navegador → "Agregar a la pantalla de inicio".

## Usuarios de prueba

Todos usan el **PIN `1234`**. La pantalla de entrada pide usuario y PIN; nunca muestra la lista del personal.

| Usuario | Nombre | Rol | Qué puede hacer | Pantalla de inicio |
|---|---|---|---|---|
| `lperez` | Laura Pérez Ortiz | Captura | Descargar la jornada, identificar a la paciente, registrar pacientes y visitas, marcar con quién pasará, foto del formato, importar Excel. **No ve resultados clínicos.** | Identifica a la paciente |
| `jtorres` | Jorge Torres Navarro | Nutrición | Ver "Pacientes esperándome" y llenar **solo** somatometría (talla, peso, PA, glucosa, BT, AT). | Pacientes esperándome |
| `cruiz` | Dra. Carmen Ruiz Delgado | Médico | Llenar **solo** la consulta: motivo, factores de riesgo, exploración, BIRADS, conducta y referencia. Ve el historial clínico. | Pacientes esperándome |
| `mvega` | Dra. Mariana Vega Salinas | Patología | Llenar **solo** el resultado de citología. Ve el historial clínico. | Pacientes esperándome |
| `smendez` | Sofía Méndez Aguilar | Administración | Dar de alta personal, crear jornadas, revisar "¿Es la misma persona?" y "Dos personas cambiaron el mismo dato", bitácora y tablero. **No ve datos clínicos.** | Tablero |

Los permisos se validan en el servidor: si un rol intenta algo que no le toca, el servidor lo rechaza aunque se fuerce desde el navegador.

## Pacientes de prueba (para buscar)

| Nombre | Nacimiento | Teléfono | ID EIRA | Para probar |
|---|---|---|---|---|
| Lucía Ramírez Torres | 05/01/1990 | 55-0000-0003 | `RATL900105` | Búscala **sin acentos** ("Lucia Ramirez Torres"): coincidencia fuerte con motivos |
| Juana Martínez García | 30/07/1972 | 55-0000-0002 | `MAGJ720730` | Paciente con visita anterior e historial |
| Ana Sánchez Cruz / Ana Cruz Sánchez | 22/11/1968 | 55-0000-0004 | `SACA681122` / `CRSA681122` | La misma persona registrada dos veces: aparece en "¿Es la misma persona?" |
| Rosa Flores Morales / Rosa Flores Mendoza | 18/04/1979 / 02/09/1995 | 55-0000-0006 / 0007 | `FLMR790418` / `FLMR950902` | Nombre parecido, fecha distinta: solo cuenta como coincidencia débil |
| María Guadalupe Hernández López | 12/03/1985 | 55-0000-0001 | `HELM850312` | Visita anterior con BIRADS |
| Elena Gómez Vázquez | 01/12/1983 | 55-0000-0008 | `GOVE831201` | Sin visitas anteriores |

## Recorrido de 5 minutos (con señal)

Abre **dos ventanas**: una normal y una de incógnito. Cada una funciona como una tableta distinta, con su propia sesión y sus propios datos guardados.

1. **Ventana 1, captura:** entra como `lperez` → "Paquete de jornada" → descarga la jornada.
2. **Identificar primero:** en "Identifica a la paciente" escribe `Lucia Ramirez Torres`, `05 / 01 / 1990` y el teléfono `55-0000-0003` → "Buscar". Verás **Coincidencia fuerte** con los motivos (misma fecha, nombre parecido, mismo teléfono) y su visita anterior.
3. **"Es ella"** → marca "Revisión mamaria" (la app propone que pase con Nutrición y Médico) → "Guardar visita". Anota el **folio** grande (por ejemplo `A8-001-B`).
4. **Ventana 2, nutrición:** entra como `jtorres` → descarga la jornada. En "Pacientes esperándome" aparece Lucía con su folio → "Atender" → llena talla, peso y PA → "Guardar y terminar".
5. **Médico:** sal y entra como `cruiz` en la ventana 2 → "Atender" → llena BIRADS y conducta → "Guardar y terminar". Abre el expediente: dos visitas, resultados agrupados por estación.
6. **Paciente nueva:** en la ventana 1 busca a alguien que no existe; solo entonces aparece "registrar nueva". Escribe nombre(s) y apellidos por separado: el **ID EIRA** se calcula solo.
7. **Administración:** entra como `smendez` → "Personal" (da de alta a alguien), "Jornadas" (el nombre se propone con el lugar y el mes), "¿Es la misma persona?" (vincula a Ana: ninguno de los dos registros se borra) y "Bitácora" (busca a Lucía: todo su recorrido en lenguaje sencillo).

## Probar sin señal

La app sigue funcionando sin internet porque guarda la jornada en el dispositivo.

1. Con señal: entra y **descarga el paquete de jornada** (paso 1 de arriba).
2. Corta la red **solo para la app**: en Chrome abre las herramientas de desarrollo (`F12`) → pestaña **Network** → cambia "No throttling" a **Offline**. En el celular con la app instalada, activa el modo avión.
3. La barra superior cambia a **"Sin señal"**. Busca a Lucía, registra una visita: la barra dirá **"1 cambio por enviar · desde HH:MM"**.
4. **Estaciones sin internet:** en la otra ventana (también Offline), como `jtorres`, escribe el folio en "Teclear folio". Verás "Esta visita aún no llega a esta tableta…"; llena el paso igual.
5. **Vuelve la señal:** regresa a "No throttling", primero en la ventana de nutrición y luego en la de captura. Todo se envía solo y se une sin duplicar: "Todo enviado".
6. **Entrada sin señal:** sin red, solo puede entrar quien ya entró antes en ese dispositivo (los últimos 4 días). Con 5 PIN equivocados, ese usuario se bloquea 15 minutos en ese dispositivo.

## Probar la foto del formato (AWS Textract)

1. Descarga una imagen de formato ficticio llenado: [formato-01.png](../datos-ficticios/formatos/formato-01.png) (Lucía Ramírez Torres), [formato-02.png](../datos-ficticios/formatos/formato-02.png) (paciente nueva) o [formato-03.png](../datos-ficticios/formatos/formato-03.png) (un dato dudoso). También puedes abrirla en otra pantalla y fotografiarla con la cámara del celular.
2. Como `lperez`, con señal: "Identificar con foto" → sube o toma la foto.
3. Textract lee **solo los datos de identificación**; los dudosos aparecen en ámbar con "Revisa este dato". Confirma y la app busca coincidencias. La imagen se guarda cifrada y privada.
4. Sin señal el botón "Identificar con foto" no aparece; "Adjuntar foto del formato" guarda la imagen y la envía al volver la señal.

## Probar la importación de Excel

1. Como `lperez`: "Importar desde Excel" → descarga la plantilla, o usa el ejemplo [plantilla-llena.xlsx](../datos-ficticios/excel/plantilla-llena.xlsx).
2. Súbelo: verás 3 pacientes nuevas, 1 "¿Es alguna de ellas?" (Juana) y 1 fila con un error explicado en lenguaje sencillo. **Nada se registra hasta que una persona decide fila por fila.**
3. El ejemplo [excel-eira-ejemplo.csv](../datos-ficticios/excel/excel-eira-ejemplo.csv) tiene columnas distintas: la app propone qué columna es cada dato y una persona confirma.

## Qué está simulado o pendiente

- Usuarios de demostración con PIN fijo (en un piloto: Amazon Cognito con MFA).
- El servidor MCP para agentes de IA (Devin, Claude) está en construcción.
- Los diagnósticos de citología se muestran como "Código N" hasta tener los textos del formato de EIRA.
- Preguntas abiertas para EIRA: qué va en la casilla 11 del ID, quién resuelve duplicados en campo, retención de datos.

## Restablecer los datos

Si alguien deja la demo en un estado raro, el equipo puede volver a cargar los datos ficticios con el procedimiento de `docs/DEPLOY.md` (reiniciar la base y correr la semilla). Si eres del jurado y lo necesitas, pídelo en el canal del hackathon.
