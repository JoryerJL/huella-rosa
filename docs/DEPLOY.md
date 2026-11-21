# Despliegue de demostración en AWS

Huella Rosa corre en una sola máquina EC2 en `us-east-1`, publicada en **https://huella-rosa.jjjl.dev** a través de un Cloudflare Tunnel. Solo contiene datos ficticios.

## Arquitectura

```
Navegador / tableta ──HTTPS──▶ Cloudflare (huella-rosa.jjjl.dev, CNAME con proxy)
                                     │  Cloudflare Tunnel "huella-rosa" (sale desde la máquina; no hay puertos abiertos)
                                     ▼
EC2 t4g.small (Amazon Linux 2023 arm64, subred pública sin reglas de entrada)
  docker compose -f docker-compose.prod.yml
   ├─ cloudflared  → http://app:3001
   ├─ app          Hono: /api + la PWA compilada (SERVE_WEB=1), SQLite en el volumen "db"
   └─ valkey       valkey/valkey:8 con AOF en el volumen "valkey-data"
        │ rol de la instancia (sin llaves en disco)
        ├─ S3  huella-rosa-forms-888577060863 (fotos de formatos; privado, SSE-S3)
        └─ Textract AnalyzeDocument (FORMS) para leer los formatos
Operación: SSM Session Manager / Run Command (sin SSH ni llaves).
```

- La infraestructura de AWS es una pila de AWS CDK (TypeScript) en `infra/`: `HuellaRosaStack`.
- El token del túnel vive en SSM Parameter Store (`/huella-rosa/tunnel-token`, SecureString), fuera de la pila. La máquina lo lee al arrancar y lo escribe en `/opt/huella-rosa/.env.tunnel` (permisos 600). Nunca está en el repositorio ni en la plantilla.
- Al primer arranque la máquina instala Docker, compose y git, clona la rama `deploy` en `/opt/huella-rosa`, escribe `.env` (`OCR_MODE=textract`, `STORAGE_MODE=s3`, `S3_BUCKET`, `AWS_REGION=us-east-1`, `PORT=3001`) y ejecuta `docker compose -f docker-compose.prod.yml up -d --build`. La bitácora del arranque queda en `/var/log/huella-rosa-bootstrap.log`.
- En cada arranque del contenedor `app` se aplican las migraciones (`prisma migrate deploy`). Los datos ficticios se cargan solo la primera vez (marca `/data/.seeded` en el volumen).

## Recursos creados

Cuenta `888577060863`, región `us-east-1`, identidad usada: `arn:aws:iam::888577060863:user/joryerdev` (perfil `default` de la AWS CLI). Todo lleva la etiqueta `Project=huella-rosa`.

| Recurso | Identificador |
|---|---|
| Pila de CloudFormation | `arn:aws:cloudformation:us-east-1:888577060863:stack/HuellaRosaStack/94e0a640-e5e8-11f1-bded-0affcf8b7305` |
| VPC 10.42.0.0/16 | `vpc-077887540f60fd817` |
| Subred pública (us-east-1a) | `subnet-09cc2f4de4e05a5ef` |
| Internet gateway | `igw-0602abf4745c5aea9` |
| Tabla de rutas (0.0.0.0/0 → IGW) | `rtb-063ba7fcd6e64340a` |
| Grupo de seguridad (sin reglas de entrada) | `sg-0632bbbfa1e9fbbfe` |
| Instancia EC2 t4g.small, 20 GB gp3 cifrado, IMDSv2 | `i-03211c39d740dee06` |
| Rol de la instancia | `HuellaRosaStack-InstanceRole3CCE2F1D-Q1Z4G4KDdgrE` |
| Perfil de instancia | `HuellaRosaStack-AppInstanceInstanceProfileC6B6EFAA-xNsrfMMWTlzH` |
| Bucket S3 | `huella-rosa-forms-888577060863` |
| Lambda que vacía el bucket al destruir (CDK) | `HuellaRosaStack-CustomS3AutoDeleteObjectsCustomRes-bmARIh6tKa2K` |
| Parámetro SSM (fuera de la pila) | `/huella-rosa/tunnel-token` (SecureString, `alias/aws/ssm`) |
| Cloudflare Tunnel (fuera de AWS) | `huella-rosa`, id `7a6c5e4d-e638-4105-8125-898be14d488d`, gestionado de forma remota |
| Registro DNS (zona `jjjl.dev`) | `huella-rosa.jjjl.dev` CNAME con proxy → `7a6c5e4d-e638-4105-8125-898be14d488d.cfargotunnel.com`, id `8f6d885df9d3e182316690ba65553930` |

La pila `CDKToolkit` (bootstrap de CDK) ya existía en la cuenta y no es parte de este despliegue.

Permisos del rol de la instancia: `AmazonSSMManagedInstanceCore`; lectura, escritura y borrado de objetos en el bucket; `textract:AnalyzeDocument`; `ssm:GetParameter` solo sobre `/huella-rosa/tunnel-token`.

## Costo mensual estimado

Precios públicos bajo demanda en `us-east-1`, 730 horas al mes:

| Concepto | Costo aprox. (USD/mes) |
|---|---|
| EC2 t4g.small (0.0168/h) | 12.26 |
| EBS gp3 20 GB (0.08 por GB) | 1.60 |
| IPv4 pública (0.005/h) | 3.65 |
| S3 (pocos MB de fotos) | < 0.05 |
| Parámetro SSM estándar, Lambda de limpieza, Cloudflare Tunnel | 0 |
| **Total fijo** | **≈ 17.6** |
| Textract AnalyzeDocument con FORMS | 0.05 por página leída (100 fotos ≈ 5 USD) |

## Cómo desplegar desde cero

Requisitos: AWS CLI con el perfil `default` de la cuenta, Node 22 o más reciente, `cf` (CLI de Cloudflare) con sesión iniciada.

```sh
# 1. Token del túnel en SSM (una sola vez; no lo imprimas)
TOKEN=$(cf tunnels token get 7a6c5e4d-e638-4105-8125-898be14d488d | jq -r 'if type=="string" then . else .token end')
jq -n --arg v "$TOKEN" '{Name:"/huella-rosa/tunnel-token",Type:"SecureString",Value:$v,Tags:[{Key:"Project",Value:"huella-rosa"}]}' > /tmp/param.json
aws ssm put-parameter --region us-east-1 --cli-input-json file:///tmp/param.json && rm /tmp/param.json; unset TOKEN

# 2. Infraestructura (si la cuenta no tiene bootstrap: npx --prefix infra cdk bootstrap aws://888577060863/us-east-1)
npm run infra:diff
npm run infra:deploy
```

La máquina tarda unos 10 minutos en instalar Docker y compilar la imagen.

## Cómo actualizar

La máquina sigue la rama `deploy`. Después de subir cambios a esa rama:

```sh
aws ssm send-command --region us-east-1 --instance-ids i-03211c39d740dee06 \
  --document-name AWS-RunShellScript --comment "huella-rosa update" \
  --parameters 'commands=["cd /opt/huella-rosa && git pull --ff-only && docker compose -f docker-compose.prod.yml up -d --build"]'
```

Para entrar a la máquina: `aws ssm start-session --region us-east-1 --target i-03211c39d740dee06` (requiere el plugin de Session Manager).

Si cambia la infraestructura o el script de arranque (`infra/lib/huella-rosa-stack.ts`), usa `npm run infra:diff` y luego `npm run infra:deploy`. **Un cambio en el script de arranque reemplaza la instancia** y con ella la base SQLite y los datos de Valkey; los datos ficticios se vuelven a cargar.

## Cómo desmontar todo

```sh
# AWS: instancia, red, rol, bucket (se vacía solo) y la Lambda de limpieza
npm run infra:destroy

# Token del túnel
aws ssm delete-parameter --region us-east-1 --name /huella-rosa/tunnel-token

# Opcional, Cloudflare: registro DNS y túnel
cf dns records delete 8f6d885df9d3e182316690ba65553930 -z jjjl.dev
cf tunnels delete 7a6c5e4d-e638-4105-8125-898be14d488d
```

Comprobación: `aws cloudformation describe-stacks --region us-east-1 --stack-name HuellaRosaStack` debe responder que la pila no existe.

## Prueba de humo (21 nov 2026)

Desde fuera de AWS, contra https://huella-rosa.jjjl.dev:

| Prueba | Resultado |
|---|---|
| `GET /api/health` | 200 `{"db":true,"valkey":true}` |
| `GET /` | 200 `text/html` por HTTPS |
| `GET /sw.js`, `GET /manifest.webmanifest` | 200 `text/javascript` y `application/manifest+json`, ambos con `Cache-Control: no-cache` |
| `POST /api/auth/login` (`smendez` y `lperez`, PIN 1234) | 200 |
| `GET /api/sync/events` (aviso en vivo por el túnel) | 200 `text/event-stream`, llega `: connected` |
| `POST /api/scans` con la foto PNG de `datos-ficticios/formatos/formato-01.svg` (como `lperez`) | 201, estado `READ`; Textract leyó `fullName`, `birthState`, `formId`, `residence`, `mobile` (0.95) y `birthDate` (0.96); `phone` vacío |
| Foto guardada en S3 | `scans/9b1765e9-def4-4698-a32b-3f9d7fdd1b45.png`, SSE-S3; acceso público 403 |

## Riesgos y límites

- **HTTP no redirige a HTTPS.** La zona `jjjl.dev` no tiene activado "Always Use HTTPS" y este despliegue no cambia ajustes de la zona. Comparte siempre el enlace con `https://`: sin HTTPS la app no instala su service worker y no abre sin señal.

- **Una sola máquina, sin respaldos.** SQLite y Valkey viven en volúmenes de Docker en el disco de la instancia. Si la instancia se reemplaza o se destruye la pila, se pierden los datos (solo ficticios). Para un piloto: base administrada (RDS/PostgreSQL) y respaldos.
- **Sitio público.** Cualquiera con la URL ve la pantalla de entrada. Protegen el acceso el usuario y PIN, el límite de intentos en Valkey y que solo hay datos ficticios. Para un piloto conviene Cloudflare Access delante.
- **Usuarios demo con PIN conocido** (por ejemplo `smendez` / 1234). No usar con datos reales.
- **Token del túnel.** Quien lo tenga puede conectar otro origen al mismo nombre. Está en SSM (SecureString) y en `/opt/huella-rosa/.env.tunnel` con permisos 600. Si se filtra, rótalo en Cloudflare y vuelve a guardar el parámetro.
- **Costo de Textract por uso.** Cada foto subida cuesta unos 0.05 USD; no hay tope.
- **Versiones no fijadas en el arranque.** El script descarga la última versión de los plugins de Docker compose y buildx desde GitHub; un cambio de versión podría romper un arranque nuevo.
- **IPv4 pública.** Solo se usa para salir a internet (imágenes, GitHub, SSM, túnel); el grupo de seguridad no tiene reglas de entrada.
