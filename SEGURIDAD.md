# Seguridad de la base de datos — Teleprogreso S.A.

Este documento explica cómo está protegida la base de datos, qué cambió
respecto de la configuración anterior y qué hay que hacer para mantenerla así.
No describe funcionalidad de la aplicación: nada de lo que hay aquí cambia lo
que ve o hace el usuario.

## La idea en una frase

**La base de datos no es alcanzable desde ningún lado.** No publica puertos, no
tiene salida a internet y solo el contenedor del backend puede abrirle una
conexión — y aun ese tiene que presentar contraseña. La única puerta hacia los
datos es la API, y esa puerta pide credenciales, aguanta ataques de fuerza
bruta y responde con los privilegios mínimos.

## Las cinco capas

### 1. Red — nadie puede siquiera tocar el motor

| Antes | Ahora |
|---|---|
| `ports: 5433:5432`, escuchando en **todas** las interfaces del equipo | Sin puertos publicados |
| Cualquiera en la misma wifi podía conectar y probar contraseñas | Solo el contenedor `backend` tiene ruta hacia el motor |
| Un único bridge compartido con todo | Red `teleprogreso_datos` marcada `internal: true` |

`internal: true` significa que ese segmento de red no tiene puerta de enlace:
aunque alguien lograra ejecutar código dentro del contenedor de la base, no
tiene por dónde sacar la información ni descargar herramientas.

El backend es el único servicio conectado a las dos redes: habla con la base
por la interna y atiende al navegador por la pública. El frontend nunca ve la
red de datos.

**Para administrar la base a mano** tienes dos opciones:

```bash
docker compose exec db psql -U <usuario> -d <base>
```

O, si necesitas DBeaver/pgAdmin, abre el puerto temporalmente en `127.0.0.1`
(nunca en la red local):

```bash
docker compose -f docker-compose.yml -f docker-compose.admin.yml up -d
```

Y ciérralo cuando termines con `docker compose up -d`.

### 2. Motor — autenticación obligatoria y moderna

`backend/db/pg_hba.conf` se monta de solo lectura y se le pasa a Postgres con
`-c hba_file=...`. Se monta en vez de dejar que `initdb` lo genere porque el
archivo generado solo se escribe cuando el volumen se crea de cero: si el
volumen ya existía, esas reglas nunca se actualizarían.

Reglas:

- `scram-sha-256` obligatorio en **todas** las conexiones TCP. Nunca `trust`,
  nunca `md5` (roto desde hace años), nunca contraseña en claro.
- `reject` explícito para cualquier origen fuera de la subred del contenedor.
- Socket unix local en `trust`, porque solo lo alcanzan procesos que ya están
  dentro del contenedor y porque el arranque de la imagen oficial lo necesita.

Además, por parámetros de servidor: `password_encryption=scram-sha-256`,
registro de conexiones y desconexiones con IP de origen, registro de todo
cambio de esquema (`log_statement=ddl`) y corte de transacciones ociosas.

El contenedor corre con `no-new-privileges` y con todas las capacidades de
Linux retiradas salvo las cinco que el entrypoint de Postgres necesita.

### 3. Privilegios — el backend ya no es superusuario

Opcional pero recomendado. Rellenando `APP_DB_USER` y `APP_DB_PASSWORD` en el
`.env`, el backend se conecta con un rol que:

- no es superusuario y no puede llegar a serlo,
- no puede crear roles ni bases,
- no puede leer las bases `postgres` ni `template1`,
- no puede ejecutar comandos del sistema desde SQL (`COPY … TO PROGRAM`),
- tiene tope de 40 conexiones y timeouts propios.

- no es dueño de ninguna tabla ni puede crear objetos (Sprint 9): las
  migraciones, el seed y la purga los ejecuta el propietario del esquema
  (`POSTGRES_USER`) en el servicio de un solo uso `migraciones` de
  docker-compose, que es además el único contenedor que conoce esa contraseña.
  El backend arranca cuando ese servicio terminó bien;
- sobre la bitácora de auditoría solo tiene `SELECT` e `INSERT` (ver capa 5).

Si esas dos variables quedan vacías, todo sigue funcionando exactamente igual
que antes con el usuario de siempre: la mejora es opcional para no romper un
entorno que ya está corriendo. En ese caso la bitácora no tiene protección a
nivel de base frente al backend (es superusuario) y la pantalla de la
bitácora lo avisa.

- Volumen nuevo → el rol se crea solo (`backend/db/init/10_rol_aplicacion.sh`).
- Base que ya existe → aplica una vez `backend/db/aplicar_rol_aplicacion.sql`
  (instrucciones dentro del archivo) y luego pon las variables en el `.env`.
  Si una versión anterior de ese script le había dado al rol de la app la
  propiedad de las tablas, la nueva se la devuelve al superusuario.
- Despliegue de un solo contenedor (Railway) con rol mínimo → define además
  `DATABASE_URL_MIGRACIONES` con el propietario: Alembic, el seed y
  `mantenimiento.py` la usan; el backend sigue con `DATABASE_URL`.

### 4. Aplicación — la única puerta

Como el motor quedó inalcanzable, todo ataque tiene que pasar por la API.

**Llave de firma.** El backend se niega a arrancar si `SECRET_KEY` es corta,
es un valor de ejemplo o tiene poca variedad de caracteres. No es una
formalidad: con HS256, quien adivine esa llave puede fabricarse un token de
administrador y leer la base entera sin tocar Postgres. Al fallar, el mensaje
de error incluye una llave válida ya generada para copiar y pegar.

**Fuerza bruta en el login.** Tres frenos simultáneos, cada uno tapando el
hueco que dejan los otros:

- por `(IP, correo)`: 5 fallos en 5 minutos → 15 minutos de bloqueo;
- por cuenta, ignorando el origen: 50 fallos en 5 minutos → mismo bloqueo.
  Existe porque el primer freno se esquiva repartiendo el ataque entre muchas
  IPs. El umbral es alto a propósito para que nadie pueda dejar fuera a un
  empleado real fallando su contraseña a propósito.
- por IP y contando todos los intentos, no solo los fallidos: 30 por minuto.
  Los dos anteriores se esquivan cambiando de correo en cada petición; este no.
  Además protege la CPU: cada verificación cuesta unos 250 ms de bcrypt, y sin
  tope unas pocas peticiones por segundo dejarían al backend sin capacidad para
  atender a nadie más.

La verificación de contraseña se ejecuta en un hilo aparte. Antes corría dentro
del bucle de eventos, así que cada login congelaba el servidor ~250 ms para
todos los demás usuarios; con suficientes intentos simultáneos eso solo es una
forma de tirar el servicio.

**Enumeración de cuentas.** Un correo inexistente ahora tarda lo mismo en
responder que uno real con contraseña equivocada: se verifica un hash señuelo
para igualar el tiempo. Sin eso, midiendo la respuesta se puede averiguar qué
correos están dados de alta, que es el primer paso de un ataque dirigido.

**JWT.** Lista blanca de algoritmos al decodificar (cierra el ataque de
`alg: none` y la confusión HS/RS), rechazo de tokens sin expiración o sin
sujeto, y `python-jose` actualizado a 3.4.0 para dejar atrás CVE-2024-33663 y
CVE-2024-33664.

**Frenos de tráfico.** Tope de 240 peticiones por minuto y por IP, y corte de
cualquier cuerpo de petición mayor de 10 MB antes siquiera de leerlo.

**CORS y Host.** `*` está prohibido por configuración. En producción se exige
https en los orígenes y una lista de `ALLOWED_HOSTS`.

**Reportes: misma cerradura para ver y para descargar.** Todos los reportes
(`/reportes/*`, incluida la serie temporal) son de admin y gerente, y su
descarga en Excel exige exactamente el mismo rol. Hasta la HU-S9-04 la
exportación admitía además al supervisor, que bajaba en un archivo datos que
no podía consultar. `tests/test_reportes_permisos.py` recorre cada par
reporte/exportación y falla si alguno vuelve a tener roles distintos.

**Subidas de imágenes.** Además de la extensión y el tamaño (5 MB), se lee la
firma de los primeros bytes: solo entran JPEG, PNG, WEBP y GIF reales. Un HTML,
un SVG o un ejecutable renombrado a `.jpg` se rechaza con 400 antes de tocar
el disco, y una imagen con la extensión equivocada se guarda con la de su
formato real, para que `/static` nunca la sirva con un tipo engañoso
(`services/uploads.py`).

**Cabeceras.** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP
restrictiva con `sandbox` (importante para `/static`, donde se sirven imágenes
subidas por usuarios) y HSTS en producción.

**Documentación de la API.** `/docs`, `/redoc` y `/openapi.json` dejan de
publicarse cuando `ENVIRONMENT=production`: son un mapa completo de la
superficie de ataque.

**Secretos por contenedor.** Antes los tres servicios recibían el `.env`
entero: el contenedor de la base conocía la `SECRET_KEY` y el de React conocía
la contraseña de Postgres. Ahora cada uno recibe solo lo suyo.

### 5. Auditoría — lo que se hizo no se puede borrar

Desde el Sprint 9 (HU-S9-03) cada cambio de datos y cada evento relevante
queda en `bitacora_auditoria` (migraciones `0009` y `0010`):

- **Captura automática.** Un hook del ORM registra todo INSERT/UPDATE/DELETE
  hecho durante una petición, con el antes y el después de cada columna, en la
  misma transacción (si la operación falla, no queda rastro falso). También
  los `insert/update/delete` masivos. Aparte se registran el login fallido o
  bloqueado, los bloqueos por exceso de peticiones, el logout, todo 403 y las
  lecturas de datos sensibles (reportes, recorridos y posiciones GPS, personal,
  asistencia, evidencias y la propia bitácora; una lectura idéntica repetida se
  registra una vez cada 5 minutos). Cada fila lleva actor, rol, IP y
  `request_id`, el mismo que se devuelve en la cabecera `X-Request-ID`.
- **Sin secretos.** `hash_contrasena` y `version_token` quedan como `***`. Los
  puntos GPS se registran resumidos (cuántos e ids), sin coordenadas.
- **Inmutable para la app.** El rol de la aplicación solo tiene `SELECT` e
  `INSERT` y no es propietario de la tabla, así que no puede desactivar sus
  triggers. Los triggers rechazan `UPDATE` siempre, `TRUNCATE` siempre (también
  al propietario) y `DELETE` salvo dentro de la purga, que exige ser el
  propietario. Probado contra PostgreSQL con un rol al que se le dieron todos
  los permisos a propósito.
- **Cadena de hashes calculada por la base.** Un trigger asigna id, hora y
  `hash = sha256(contenido canónico + hash_anterior)` bajo un candado: el
  backend no puede fabricar un hash ni una fecha. `GET /auditoria/verificacion`
  y `python mantenimiento.py verificar-bitacora` recorren la cadena y dicen en
  qué fila se rompió (contenido alterado, fila que falta o comienzo borrado
  fuera de una purga).
- **Retención.** `python mantenimiento.py purgar` borra lo anterior a
  `RETENCION_BITACORA_DIAS` (90) dejando un ancla con el hash de la última fila
  borrada, para que la cadena que sobrevive siga verificándose.
- **Consulta.** Solo el admin (`/supervisor/bitacora`, `GET /auditoria`), con
  filtros, detalle del antes/después, exportación a Excel y aviso si la cadena
  está rota o si la conexión del backend podría alterarla.

## Sesión

El JWT dura una hora. Antes nadie miraba su `exp`: la sesión se acababa en seco,
la siguiente petición devolvía 401 y el cliente hacía
`window.location.href = '/login'` — una recarga completa del navegador que se
llevaba por delante lo que el técnico estuviera escribiendo, y que con varias
peticiones en vuelo se repetía una vez por cada 401.

`POST /auth/renovar` emite un token nuevo para una sesión **todavía válida** y
revoca el anterior en el acto, para que no queden dos tokens vivos de la misma
sesión. **No es un refresh token**: no hay credencial aparte y la validación es
`get_current_empleado`, la misma dependencia que protege todo lo demás. Por eso
un token revocado, uno con el `version_token` viejo —le cambiaron o le
restablecieron la contraseña— y una cuenta desactivada **no renuevan nada**:
ahí la sesión tiene que morir de verdad. Renovar extiende algo vivo, no
resucita.

Cada renovación deja fila en la bitácora, con su actor y su IP.

En el cliente, el aviso sale cinco minutos antes del corte y solo ofrece dos
salidas explícitas —seguir conectado o cerrar sesión— porque la tercera,
ignorarlo, es justo la que había antes. Cuando la sesión sí muere se navega con
React Router a `/login?expirado=1`, que explica el motivo en vez de dejar al
usuario en la pantalla de login sin saber si pulsó algo sin querer.

Y lo escrito en el modal de finalizar tarea se guarda en `localStorage`
**mientras se escribe** — si lo que se cae es la pestaña entera no hay ningún
"al cerrar" que ejecutar — y se reofrece al volver. La foto no cabe ahí: se
guarda su nombre para que el técnico sepa cuál volver a elegir.

## Retención de datos

`python mantenimiento.py purgar` corre en cada arranque (servicio
`migraciones`, o el `CMD` del Dockerfile) y conviene programarlo además una vez
al día (ver README):

- tokens revocados ya expirados (antes solo se purgaban al hacer logout);
- puntos GPS de los técnicos con más de `RETENCION_UBICACIONES_DIAS` (90);
- filas de la bitácora con más de `RETENCION_BITACORA_DIAS` (90), con ancla.

Cada purga deja su fila en la bitácora con rol `sistema`.

## Inyección SQL

Se revisó el backend completo. Todas las consultas se construyen con el ORM de
SQLAlchemy o con sentencias parametrizadas; no hay una sola cadena SQL armada
con datos que vengan del usuario. Los dos `text()` con formato que existen
(`seed.py`) interpolan nombres de tabla leídos de los metadatos del propio
modelo, no de una petición.

## Qué tienes que hacer tú

1. Copia `.env.example` a `.env` y rellénalo. Para cada secreto:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

2. Opcional pero recomendado: define `APP_DB_USER` y `APP_DB_PASSWORD` para
   que el backend deje de conectarse como superusuario. Es lo que hace que la
   bitácora de auditoría sea inmutable también para el backend.
3. Levanta normalmente con `docker compose up -d` (primero corre el servicio
   `migraciones` y después arranca el backend).
4. Programa la purga diaria (`python mantenimiento.py purgar`, ver README) y,
   de vez en cuando, revisa la pantalla Bitácora o corre
   `python mantenimiento.py verificar-bitacora`.

## Lo que esto no cubre

Conviene tenerlo claro para no dar por resuelto lo que no lo está:

- **Tráfico cifrado hacia la base.** La conexión backend↔Postgres va en claro
  dentro de la red interna de Docker. Es aceptable porque esa red no sale del
  host; en un despliegue donde la base viva en otra máquina hay que activar TLS
  (`ssl=on` con certificados) y exigir `hostssl` en `pg_hba.conf`.
- **Copias de seguridad.** No hay ninguna configurada. La disponibilidad de los
  datos es parte de su seguridad: un ransomware o un `docker volume rm` a
  destiempo pesan más que cualquier intrusión.
- **Cifrado en reposo.** El volumen de Postgres no está cifrado. Quien tenga
  acceso físico o administrativo al host puede leerlo.
- **Contadores en memoria.** Los límites de frecuencia viven en el proceso. Con
  un solo worker de uvicorn (el caso actual) son exactos; con varias réplicas
  cada una lleva su cuenta y habría que mover el estado a Redis.
- **Dependencias.** En el Sprint 9 se subió el framework a `fastapi 0.133.1`,
  `starlette 1.7.0` y `python-multipart 0.0.32`, lo que cierra los avisos de
  denegación de servicio y de manejo de formularios que arrastraban
  `starlette 0.37.2` y `python-multipart 0.0.9`. El CI corre `pip-audit` y
  `npm audit --audit-level=high` en cada PR (job "Auditoría de dependencias",
  informativo por ahora). Siguen abiertos, a resolver antes de volverlo
  bloqueante:
  - backend: `python-jose 3.4.0` y sus dependencias `ecdsa` (sin versión
    corregida) y `pyasn1 0.4.8`; la salida es migrar a PyJWT. También
    `python-dotenv 1.0.1` (corregido en 1.2.2) y `pytest 8.1.1` (solo pruebas).
  - frontend en producción: `axios` y `form-data` (alto) y `@remix-run/router`
    (moderado); en desarrollo, `vitest`/`tinypool`, `workbox-build` y otras
    herramientas de build y pruebas.
- **Bitácora sin rol mínimo.** Si el backend se conecta como superusuario (sin
  `APP_DB_USER`, el caso de un Railway sin configurar), la base no puede
  impedirle alterar la bitácora: queda solo la detección por la cadena. La
  pantalla de la bitácora lo avisa.
- **Borrado del final de la bitácora.** La cadena detecta filas alteradas,
  filas que faltan en medio y el borrado del comienzo, pero no que alguien con
  acceso de superusuario borre las últimas filas: para eso hace falta anclar
  el último hash fuera de la base (firma externa o almacenamiento inmutable),
  que quedó fuera del sprint a propósito.
- **IP en la bitácora.** Uvicorn arranca con `--forwarded-allow-ips=*` para
  confiar en el proxy de Railway. Si el backend se expusiera directamente, sin
  proxy delante, un cliente podría falsear su IP con `X-Forwarded-For`; en ese
  caso hay que limitar esa opción a la IP del proxy.
