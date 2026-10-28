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
sujeto. La librería es PyJWT desde el Sprint 10 (HU-S10-03): `python-jose`,
aun en 3.4.0, arrastraba `ecdsa` y `pyasn1` con avisos abiertos. El cambio no
invalida sesiones: mismo HS256 y misma llave.

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

### Alertas de seguridad (HU-S10-05)

Registrar no alcanza si nadie lo lee: hasta este sprint un ataque de fuerza
bruta solo se descubría si el admin abría la bitácora y lo buscaba.
`app/services/alertas_seguridad.py` lee la bitácora y deja alertas en la misma
tabla y pantalla que las operativas, en la pestaña **Seguridad** de Alertas:

| Alerta | Cuándo | Severidad |
|---|---|---|
| Intentos de acceso | 10 logins fallidos contra un correo o desde una IP en 10 minutos | Crítica |
| Cuenta bloqueada | El límite de login bloqueó una cuenta (un ataque desde una sola IP llega aquí primero) | Advertencia |
| Accesos denegados | 5 respuestas 403 a un mismo empleado en 10 minutos | Advertencia |
| Cuenta de administrador | Otra persona le restableció la contraseña a un admin, subió a alguien a admin o creó un admin. Cambiarse la propia no avisa | Crítica |
| Bitácora alterada | La cadena de hashes no cuadra | Crítica |
| Auditoría sin guardar | El backend no pudo guardar eventos de la bitácora (contador de HU-S10-04) | Crítica |
| Conexión privilegiada | En producción, el backend se conecta como superusuario o dueño de la bitácora | Crítica |

- **Solo para el admin.** `GET /alertas` no se las devuelve a supervisores ni
  gerentes, y `PATCH /alertas/{id}` les responde 404 sobre una de ellas, igual
  que con un id inventado.
- **Aunque nadie abra la pantalla.** `python mantenimiento.py alertas`,
  programado cada 5 minutos, corre las reglas, incluida la cadena entera, que
  no se recorre en cada visita porque es cara. Las dos últimas reglas miran el
  proceso y la conexión del backend, así que se evalúan al abrir Alertas.
- **Una por día.** Como las operativas, una alerta por regla, referencia y día:
  si el problema sigue, vuelve a aparecer al día siguiente.
- **Desde la alerta a la bitácora.** Cada tarjeta lleva a la bitácora ya
  filtrada por lo que la levantó.

Los umbrales viven en `app/core/reglas.py` (`UMBRAL_LOGIN_FALLIDO`,
`UMBRAL_ACCESO_DENEGADO`, `MINUTOS_VENTANA_SEGURIDAD`).

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

## Cuentas y contraseñas

Dos cosas distintas que antes estaban mezcladas: que **haya datos de
demostración** en un despliegue y que **sus contraseñas sean públicas**. Lo
primero puede ser necesario (una presentación se hace con datos de prueba); lo
segundo nunca debe pasar. El README publicaba una tabla con las contraseñas del
seed y el despliegue las usaba tal cual, así que leer el repositorio bastaba
para entrar como admin.

### Una sola política de contraseña

`validar_politica_contrasena` (`backend/app/core/reglas.py`) es la única regla,
y la usan los tres caminos que fijan una contraseña: crear un empleado
(`EmpleadoCreate`), restablecerla (`EmpleadoPasswordUpdate`, por un admin o
supervisor) y cambiarla uno mismo (`CambiarContrasenaRequest`). Antes crear y
cambiar pedían solo 8 caracteres y únicamente el restablecimiento frenaba las
contraseñas comunes: la misma clave pasaba por una puerta y la rechazaban en
otra.

Una contraseña válida:

- tiene al menos 8 caracteres y no empieza ni termina con espacios;
- no está en la lista de contraseñas comunes
  (`backend/app/core/datos/contrasenas_comunes.txt`, una por línea, sin
  distinguir mayúsculas; para añadir una basta una línea nueva, sin tocar
  código ni instalar nada). La lista incluye las contraseñas de demo que
  estuvieron publicadas;
- es distinta del correo y de su parte local (lo que va antes de la `@`);
- es distinta de la contraseña actual. Esta última solo se comprueba al
  cambiarla uno mismo: quien restablece la de otra persona no la conoce.

### Cambio obligatorio

La columna `empleado.debe_cambiar_contrasena` marca las cuentas cuya contraseña
no la eligió su dueño. Pasa a `true` cuando un admin crea un empleado, cuando
se le restablece la contraseña por la API y en la cuenta de administrador
inicial. Mientras esté en `true`, el backend solo deja pasar `/auth/me`,
`/auth/perfil`, `/auth/cambiar-contrasena`, `/auth/renovar` y `/auth/logout`; lo
demás responde 403 con `error: PASSWORD_CHANGE_REQUIRED`. El frontend lleva a
esa persona a `/cambiar-contrasena`, una pantalla sin menú donde lo único
posible es cambiarla o cerrar sesión.

Las filas que ya existían y las cuentas del seed nacen en `false`, para que las
cuentas de demo sigan entrando directo.

### Datos de demostración en el despliegue

> **Nota temporal.** Mientras esté vigente, hay datos de prueba en producción.
> Se quita de este documento al retirarlos (ver más abajo).

El seed corre en cada arranque del backend. Estas variables de entorno (en
Railway, en el servicio del backend) deciden qué siembra:

| Variable | Para qué sirve |
|---|---|
| `SEMBRAR_DEMO` | `true` siembra el escenario completo de demostración (empleados, tareas, vehículos, inventario, asistencia...). `false` siembra solo los catálogos (`tipo_pausa`) y la cuenta de administrador inicial. Hasta la presentación queda en `true` en Railway. |
| `CONTRASENA_DEMO` | Contraseña con la que se crean las cuentas de demo cuando el seed corre en un despliegue. Los valores escritos en `seed.py` son solo para desarrollo local: con `ENVIRONMENT=production` el seed se niega a usarlos. |
| `ADMIN_INICIAL_CORREO` y `ADMIN_INICIAL_CONTRASENA` | Cuenta de administrador que crea el seed con `SEMBRAR_DEMO=false`. La contraseña se valida con la política de arriba. Si falta cualquiera de las dos, no se crea a nadie y el seed lo dice en el log. Esa cuenta entra con cambio de contraseña obligatorio. |

Reglas que no cambian con ninguna variable:

- El seed **no imprime contraseñas** en el log de arranque.
- Si ya hay empleados en la base, el seed no vuelve a sembrar: cambiar a mano
  la contraseña de una cuenta de demo sobrevive a los despliegues.
- Las contraseñas reales de las cuentas de demo en Railway las conoce solo el
  equipo, y se comparten por un canal privado. Nunca van al repositorio, a un
  PR ni a un chat público.

### Retirar los datos de demostración

Se hace después de la presentación, cuando la empresa vaya a usar el sistema
con sus datos reales. Es un cambio de configuración, no de código:

1. Sacar un respaldo de la base, por si hace falta consultar algo de la demo.
2. En Railway: `SEMBRAR_DEMO=false`, definir `ADMIN_INICIAL_CORREO` y
   `ADMIN_INICIAL_CONTRASENA`, y quitar `CONTRASENA_DEMO`.
3. Vaciar los datos de demo (una base nueva, o el reset de `seed.py` hecho por
   el propietario de la base, ver README) y redesplegar. El seed deja solo los
   catálogos y el administrador inicial, que entra con cambio de contraseña
   obligatorio.
4. Verificar que no existe ninguna cuenta de demo (`*@teleprogreso.com` del
   seed) y que la bitácora arranca con su ancla.
5. Quitar de este documento la nota temporal de arriba.

## Retención de datos

`python mantenimiento.py purgar` corre en cada arranque (servicio
`migraciones`, o el `CMD` del Dockerfile) y conviene programarlo además una vez
al día (ver README):

- tokens revocados ya expirados (antes solo se purgaban al hacer logout);
- puntos GPS de los técnicos con más de `RETENCION_UBICACIONES_DIAS` (90);
- filas de la bitácora con más de `RETENCION_BITACORA_DIAS` (90), con ancla.

Cada purga deja su fila en la bitácora con rol `sistema`.

## Modelo de amenazas (STRIDE)

Las secciones anteriores cuentan *qué* defensa hay en cada capa. Esta cuenta lo
otro: por cada flujo del sistema, qué podría intentar alguien y qué lo frena.
Se hace por flujos y no por componentes porque un ataque no entra «por el
backend», entra por una cosa que el sistema deja hacer.

STRIDE son las seis categorías clásicas: **S**uplantación, **T**ampering
(alteración), **R**epudio, **I**nformation disclosure (fuga), **D**enegación de
servicio y **E**levación de privilegios. Donde una casilla queda sin cubrir, se
dice: eso es un riesgo residual, no un olvido (ver «Lo que esto no cubre»).

### Flujo 1 — Iniciar sesión (`POST /auth/login`)

| Amenaza | Qué intentaría | Qué lo frena |
|---|---|---|
| Suplantación | Probar contraseñas de una lista contra correos corporativos | Tres frenos independientes: por (IP, correo), por cuenta sola —para el ataque repartido entre muchas IPs— y por IP contando todos los intentos, no solo los fallidos (`core/rate_limit.py`). bcrypt a 12 rondas hace que cada prueba cueste ~250 ms |
| Suplantación | Averiguar qué correos existen para dirigir el ataque | Mismo mensaje y **mismo tiempo** en los dos casos: cuando el correo no existe se verifica un hash señuelo (`consumir_tiempo_de_hash`) |
| Suplantación | Entrar con una contraseña que viene en el manual | Las de demostración ya no están en el repositorio ni en el log de arranque, y en producción el seed se niega a usar las del código (HU-S10-01) |
| Alteración | Falsificar un JWT | HS256 con lista blanca de un solo algoritmo y `require` de `exp` y `sub`: ni `alg: none` ni cambio a RS256. La `SECRET_KEY` se valida al arrancar y el proceso aborta si es adivinable |
| Repudio | Negar los intentos | Cada fallo, cada bloqueo y cada entrada deja fila en la bitácora con IP y `request_id` |
| Fuga | Leer la respuesta para deducir el estado de la cuenta | «Correo o contraseña incorrectos» para todo; la cuenta inactiva sí se distingue, pero solo después de acertar la contraseña |
| Denegación | Gastar la CPU del servidor a base de verificaciones bcrypt | El tercer freno (30 peticiones por minuto y por IP) existe justamente para esto; bcrypt corre en un hilo aparte para no dejar sordo al bucle de eventos |
| Elevación | Pedir un token con un rol que no es el suyo | El rol sale del empleado en la base, nunca del cuerpo de la petición |

### Flujo 2 — Asignar y editar una tarea (`POST`/`PATCH /tareas`)

| Amenaza | Qué intentaría | Qué lo frena |
|---|---|---|
| Elevación | Un técnico asignándose o reasignando trabajo | `require_supervisor` en los dos endpoints; un técnico solo lee lo suyo |
| Alteración | Cerrar una tarea sin haberla hecho | Ningún camino completa sin evidencia: los tres (`PATCH /tareas/{id}`, `/estado` y `/finalizar`) pasan por `exigir_evidencia` y responden 409 (HU-S10-08) |
| Alteración | Dejar un estado o una prioridad fuera del catálogo | Los schemas lo rechazan, y desde la migración `0013` también la base, que es lo que cubre al seed, a un script y a la consola |
| Repudio | Negar un cambio | El hook del ORM escribe el antes/después de cada columna en la misma transacción |
| Denegación | Saturar a un técnico de tareas | Límite de tareas activas por técnico, comprobado también al reabrir |
| Fuga | Ver tareas de otros técnicos | `/tareas` filtra por el actor cuando el rol es técnico |

### Flujo 3 — Cerrar una tarea con evidencia (`/incidencias` + `/finalizar`)

| Amenaza | Qué intentaría | Qué lo frena |
|---|---|---|
| Alteración | Subir un HTML o un ejecutable renombrado a `.jpg` | El formato se lee de los primeros bytes del archivo, no de la extensión (`services/uploads.formato_real`) |
| Fuga | Abrir la foto de la casa de un cliente con el enlace suelto | `/static` se retiró: los archivos se sirven por `/archivos/...` con URL firmada de 10 minutos, y la firma solo se emite si el actor pasa la regla de acceso (HU-S10-02) |
| Fuga | Adivinar el nombre del archivo | 128 bits al azar en el nombre de las subidas nuevas |
| Elevación | Cerrar la tarea de otro técnico | Solo el técnico asignado, y con la jornada abierta |
| Denegación | Llenar el disco con subidas | Tope de cuerpo contado byte a byte (sirve también sin `Content-Length`) y lectura por bloques, más 5 MB por imagen |
| Alteración | Descontar material que no se usó, o no descontar el que sí | El consumo va en la misma transacción que cierra la tarea y deja su movimiento con tarea, actor y saldo (HU-S10-07) |

### Flujo 4 — Reportar ubicación (`POST /ubicaciones`)

| Amenaza | Qué intentaría | Qué lo frena |
|---|---|---|
| Suplantación | Sembrar posiciones a nombre de un compañero para fabricarle una coartada | El dueño del punto sale del token, nunca del cuerpo |
| Alteración | Mandar una coordenada imposible | Rangos validados en el schema; sin ellos PostGIS guardaría cualquier cosa |
| Alteración | Falsear la IP de origen para esquivar los límites | `request.client.host` y no la cabecera cruda; uvicorn solo traduce `X-Forwarded-For` desde el proxy que diga `FORWARDED_ALLOW_IPS` |
| Fuga | Leer dónde estuvo un técnico | Las lecturas del recorrido son de admin, supervisor y gerente, y **quién consulta** queda en la bitácora |
| Denegación | Inflar `ubicacion_empleado`, que crece sin tope | Tope por empleado en el servidor y no solo en el cliente (HU-S10-08), y purga a 90 días |
| Fuga | Sacar el histórico de meses atrás | Retención de 90 días (`RETENCION_UBICACIONES_DIAS`) |

### Flujo 5 — Reportes del gerente (`GET /reportes/*`)

| Amenaza | Qué intentaría | Qué lo frena |
|---|---|---|
| Elevación | Descargar un reporte sin el rol para verlo | El mismo rol para ver y para exportar: no hay una puerta de descarga más floja que la pantalla |
| Alteración | Meter una fórmula en el Excel del gerente a través del título de una tarea | Todo texto que empiece por `=`, `+`, `-`, `@`, tabulador o retorno se escribe precedido de `'` (HU-S10-04) |
| Fuga | Sacar la base entera en un XLSX | Tope de filas en la exportación de la bitácora; por encima se pide acotar el filtro |
| Repudio | Negar que descargó los datos de alguien | Cada exportación queda en la bitácora con sus filtros |

### Flujo 6 — Bitácora de auditoría

| Amenaza | Qué intentaría | Qué lo frena |
|---|---|---|
| Alteración | Editar o borrar una fila para tapar algo | `UPDATE` prohibido siempre; `DELETE` solo dentro de la función de purga y siendo el propietario; `TRUNCATE` prohibido incluso para el dueño |
| Alteración | Reescribir la cadena de hashes | El hash lo calcula la base en el trigger, no el backend: ni controlando el backend se puede fabricar uno |
| Alteración | Que el backend desactive el trigger | El rol de la aplicación no es el propietario de la tabla (`aplicar_rol_aplicacion.py`), y en producción el arranque se niega si lo fuera |
| Alteración | Borrar las últimas filas con el superusuario | El ancla externa: `mantenimiento.py anclar` deja id y hash en el log del servicio, fuera de la base, y `verificar-bitacora --ancla` lo detecta |
| Repudio | Actuar sin dejar rastro | `test_cobertura_auditoria.py` falla si aparece un endpoint que muta datos sin su caso en el catálogo |
| Fuga | Leer la bitácora para saber qué se vigila | Solo admin; y la bitácora nunca copia hashes de contraseña ni coordenadas |

## Matriz OWASP Top 10:2025

Una fila por categoría, con **dónde está el control** y **qué prueba lo
vigila**. La vigila a su vez `backend/tests/test_matriz_owasp.py`, que lee esta
tabla y falla si alguno de los archivos que nombra deja de existir: una matriz
que envejece en silencio es peor que no tenerla, porque se presenta como
evidencia de algo que ya no se cumple.

| Categoría | Control principal | Archivo | Prueba |
|---|---|---|---|
| A01 Control de acceso roto | Rol exigido en los 68 endpoints de dominio, técnico limitado a lo suyo, archivos subidos solo con URL firmada, 403 que no enumera roles | `backend/app/core/deps.py` | `backend/tests/test_permisos_roles.py` |
| A02 Configuración incorrecta | `SECRET_KEY` validada al arrancar, docs apagadas en producción, CORS sin comodín, contenedores sin root, cabeceras en la página | `backend/app/core/config.py` | `backend/tests/test_arranque_produccion.py` |
| A03 Cadena de suministro | Auditoría que bloquea el PR, Dependabot, Actions por SHA, imágenes por digest, detección de secretos | `.github/workflows/ci.yml` | `backend/tests/test_cadena_suministro.py` |
| A04 Fallas criptográficas | bcrypt a 12 rondas, HS256 con llave validada, SCRAM en Postgres, HSTS, enlaces de archivo firmados con llave propia | `backend/app/core/security.py` | `backend/tests/test_security.py` |
| A05 Inyección | ORM parametrizado en todo el backend, React escapa por omisión, fórmulas de Excel neutralizadas, longitudes acotadas | `backend/app/services/exportacion_reportes.py` | `backend/tests/test_formulas_excel.py` |
| A06 Diseño inseguro | Reglas de negocio centralizadas y aplicadas por todos los caminos, jornada obligatoria, kardex como único camino al stock | `backend/app/core/reglas.py` | `backend/tests/test_reglas_no_se_saltan.py` |
| A07 Fallas de autenticación | Tres frenos de fuerza bruta, anti-enumeración, revocación por `jti`, `version_token`, política única de contraseña, cambio obligatorio | `backend/app/routers/auth.py` | `backend/tests/test_politica_contrasena.py` |
| A08 Integridad de software y datos | Cadena de hashes calculada por la base, ancla externa, firma de imágenes por sus bytes, `CHECK` de catálogo | `backend/alembic/versions/0010_bitacora_inmutable.py` | `backend/tests/integracion/test_integridad_catalogos.py` |
| A09 Registro y alertas | Bitácora con actor, IP y `request_id`; alertas de seguridad sobre patrones de la propia bitácora; generación programada | `backend/app/services/alertas_seguridad.py` | `backend/tests/integracion/test_alertas_seguridad.py` |
| A10 Condiciones excepcionales | 500 con `request_id` y sin stack, errores de base como 409/422, tope de cuerpo real, `ErrorBoundary` en el frontend | `backend/app/core/exceptions.py` | `backend/tests/test_error_interno.py` |

Sobre **SSRF**, que el Top 10:2025 metió dentro de A01: el backend **no hace
ninguna petición saliente**. Nominatim lo llama el navegador, no el servidor,
así que hoy no hay ningún sitio donde una URL del usuario se convierta en una
petición del servidor. Queda escrito para que, si algún día se añade una
integración que sí salga a internet, se sepa que esa casilla estaba vacía por
construcción y no por haberla cubierto.

## Escaneo dinámico (T2)

Todo lo demás de este documento se comprueba mirando el código: las pruebas, la
auditoría de dependencias, las cabeceras de la imagen. El job
`escaneo-dinamico` del CI mira la API **corriendo**, que es lo único que se
parece a lo que ve alguien de fuera, y lo único que puede encontrar algo que a
nadie se le ocurrió escribir una prueba para.

Levanta el stack con `docker compose` y le pasa OWASP ZAP. Usa
`zap-api-scan.py` y no `zap-baseline.py`: las dos corren las mismas reglas
pasivas, pero baseline descubre las rutas siguiendo enlaces y esto es una API
JSON sin una sola página que enlace a otra — vería tres endpoints y se iría.
`api-scan` lee el `openapi.json` y recorre las 73 operaciones, que es lo que
hace que el informe sirva como evidencia.

Por eso el escaneo corre con `ENVIRONMENT=development`: en producción el
`openapi.json` no se publica a propósito (es un mapa completo de la superficie
de ataque), así que el escáner no tendría de dónde sacar las rutas.

El job es **informativo** y no bloquea, y no por pereza: sobre una API que
exige JWT en los 68 endpoints de dominio, un escáner dinámico devuelve sobre
todo 401 y avisos de cabeceras que ya están puestas. Bloquear PRs con eso
acabaría en que alguien quita el job. El valor está en el informe, que queda
como artefacto del CI (`informe-zap`).

## Copias de seguridad

Hasta el Sprint 10 no había ninguna. Todo lo anterior va de que nadie pueda
leer ni alterar los datos; esto va de lo otro, que es igual de definitivo y
mucho más probable: un `DROP`, un `--reset` corrido en el entorno equivocado,
un disco que se va. Una base cifrada y auditada que ya no existe no se
recupera con permisos.

`scripts/respaldo.sh` toma el volcado con el **propietario del esquema** y no
con el rol de la aplicación. No es un detalle: el rol de la aplicación no puede
leer `bitacora_auditoria` entera —es lo que la hace append-only de verdad—, así
que un `pg_dump` hecho con él dejaría fuera justo la tabla que no se puede
reconstruir. Para eso está `DATABASE_URL_MIGRACIONES`.

El archivo va cifrado con GPG simétrico (AES-256) y la frase se pasa por
`RESPALDO_PASSPHRASE`, nunca en la línea de comandos: ahí la vería cualquiera
con `ps`. El cifrado no es opcional, porque el volcado contiene:

- la tabla de empleados, con sus hashes de contraseña;
- `ubicacion_empleado`: dónde estuvo cada técnico y a qué hora;
- la bitácora completa.

Es, literalmente, todo lo que el resto de este documento protege, en un archivo
que se va a copiar a sitios con menos cuidado que la base.

El volcado no se escribe nunca en claro en el disco: `pg_dump | gzip | gpg` va
en una sola tubería. Y al terminar, el script lo vuelve a descifrar para
comprobar que se lee; si no, borra el archivo. Un respaldo cifrado con la frase
equivocada no se descubre hasta el día que hace falta, que es el peor día
posible.

### Prueba de restauración

Un respaldo que nadie ha restaurado es una suposición: puede estar truncado,
cifrado con otra frase o faltarle una tabla.

```bash
RESPALDO_PASSPHRASE='…' bash scripts/respaldo.sh probar backups/<archivo>
```

Crea una base temporal, restaura ahí, y comprueba cuatro cosas antes de
borrarla: que las trece tablas del dominio existen, que la bitácora llegó con
todas sus filas (si sale vacía con la de origen poblada, el volcado se hizo con
el rol de la aplicación), a qué migración corresponde el esquema, y que la
cadena de hashes de la bitácora sigue cuadrando después de restaurar — una
bitácora restaurada con la cadena rota no vale como evidencia de nada.

**Última prueba de restauración: 2026-10-28.** Resultado: correcta. Base de
origen con el escenario del seed y 73 filas de bitácora; las 73 se restauraron
y la cadena quedó íntegra. Esquema en la migración `0013`.

Cuando se restaure sobre un despliegue hay que volver a aplicar el
endurecimiento del rol (`python backend/db/aplicar_rol_aplicacion.py`): el
volcado se hace con `--no-owner --no-privileges` para que se pueda restaurar
en una base con otros nombres de rol, así que no trae los privilegios.

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
5. Programa `python mantenimiento.py alertas` cada 5 minutos y
   `python mantenimiento.py anclar` una vez al día (ver README). Guarda las
   líneas que deja `anclar`: son las que permiten notar que alguien borró el
   final de la bitácora.
6. En un despliegue, no dejes que el seed use las contraseñas de demo: define
   `CONTRASENA_DEMO` (o `SEMBRAR_DEMO=false` con `ADMIN_INICIAL_CORREO` y
   `ADMIN_INICIAL_CONTRASENA`). Ver «Cuentas y contraseñas».
7. Programa el respaldo diario (`bash scripts/respaldo.sh crear`, ver README) y
   corre `scripts/respaldo.sh probar` de vez en cuando, anotando la fecha y el
   resultado arriba. Guarda `RESPALDO_PASSPHRASE` en el gestor del equipo: sin
   ella los respaldos no sirven para nada.

## Cadena de suministro

Una dependencia vulnerable es código ajeno corriendo con los permisos de la
aplicación, así que el CI no deja entrar una (HU-S10-03).

**Auditoría obligatoria.** El job "Auditoría de dependencias" corre en cada
push y PR y ya no es informativo: si falla, el PR no se puede mergear.

- `pip-audit` sobre `backend/requirements.txt`, sin excepciones: cualquier
  aviso conocido rompe el job.
- `npm audit --omit=dev --audit-level=high` sobre el frontend: lo que se
  empaqueta y llega al navegador, desde severidad alta.

En el Sprint 10 se dejó en cero: `python-jose` (con `ecdsa` y `pyasn1`) se
cambió por PyJWT, `python-dotenv` pasó a 1.2.4, `pytest` a 9.0.3, y `axios`,
`form-data`, `follow-redirects` y `@remix-run/router` subieron sin `--force`.
Las herramientas de build y pruebas también quedaron limpias aunque el job no
las exija: `vite` 8, `vitest` 5, `vite-plugin-pwa` 2 y `@vitejs/plugin-react`
5. Con eso `workbox-build` 7.4.1 trae `@trickfilm400/rollup-plugin-off-main-thread`,
una versión preliminar de un fork; se acepta porque es la que exige la versión
oficial de Workbox, no una dependencia elegida por el proyecto.

**Dependabot.** `.github/dependabot.yml` revisa cada lunes las dependencias de
Python y npm, las Actions de los workflows y las imágenes base de Docker, y
abre PRs hacia `develop`. Los cambios menores van agrupados en un PR por
ecosistema; los mayores, cada uno en el suyo. Así una versión corregida no
depende de que alguien se acuerde de buscarla, y los PRs pasan por la misma
auditoría y las mismas pruebas que cualquier otro.

**Actions fijadas y token de solo lectura.** Cada `uses:` de los workflows
apunta a un commit concreto (`actions/checkout@11d5960… # v4.4.0`), no a una
etiqueta: una etiqueta como `v4` la puede mover cualquiera que comprometa el
repositorio de la Action, y el CI correría ese código nuevo sin que nadie lo
note. Dependabot actualiza el SHA y el comentario juntos. Los dos workflows
declaran `permissions: contents: read`, así que ni una Action comprometida
puede empujar código con el token del CI.

**Imágenes base fijadas.** Los Dockerfile, `docker-compose.yml` y el
servicio de PostGIS del CI usan `etiqueta@sha256:…` (por ejemplo
`python:3.11-slim@sha256:b7a9…`). La etiqueta queda para leerla; quien manda
es el digest, así que construir hoy o dentro de un mes da la misma imagen
aunque alguien publique otra con la misma etiqueta. Dependabot propone el
digest nuevo cuando hay versión. El de PostGIS del CI se mantiene igual al de
`docker-compose.yml` a mano.

**Secretos.** El job "Detección de secretos" corre gitleaks 8.30.1 sobre los
commits que trae cada PR o push; si encuentra una llave, un token o una
contraseña, rompe el CI. Se descarga el binario oficial y se comprueba su
SHA-256 antes de usarlo. `.gitleaks.toml` usa todas las reglas de gitleaks con
una sola excepción: la regla genérica no mira las llaves inventadas de
`backend/tests/`, pero un token de GitHub, una llave de AWS o una llave
privada pegados ahí siguen rompiendo el CI. Al introducirlo se revisó el
historial completo: los únicos hallazgos eran esas llaves de prueba.

**Excepciones aceptadas.** Lo que no bloquea queda escrito aquí con su motivo
y una fecha de revisión, en lugar de esconderlo con un `|| true`:

| Paquete | Aviso | Por qué se acepta | Revisar |
|---|---|---|---|
| `react-router` 6.30 (producción, moderado) | GHSA-wrjc-x8rr-h8h6: redirección abierta con `\` en `<Link>`/`useNavigate` | La app solo navega a rutas fijas o a la de cada rol; ninguna sale de un parámetro del usuario. La corrección solo existe en la v7, un cambio mayor | 2026-11-02 (retro) |
| `react-router` 6.30 (producción, moderado) | GHSA-337j-9hxr-rhxg: inyección en `deserializeErrors()` | Afecta a la hidratación con renderizado en servidor; esta app es una SPA | 2026-11-02 (retro) |

## Despliegue endurecido (HU-S10-06)

La API ya tenía sus cabeceras, su rol mínimo y sus límites. Lo que faltaba
era lo que la rodea: la página, los contenedores y la conexión a la base.

**La página tiene las mismas cabeceras que la API.** El nginx del frontend
(`frontend/nginx/`) manda CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy` y `Permissions-Policy` (solo GPS y cámara) en todas las
respuestas, también en `/assets` y en `sw.js`. La CSP es la defensa principal
del JWT, que vive en `localStorage`: solo corren los scripts de la propia
build, y la página solo puede hablar con la API, los mosaicos de
OpenStreetMap, Nominatim y Google Fonts. El origen de la API sale de
`VITE_API_URL` al arrancar. Para probar una CSP nueva sin romper nada,
`CSP_SOLO_REPORTE=true` la manda como `Content-Security-Policy-Report-Only`:
el navegador avisa en la consola lo que bloquearía, pero no lo bloquea.

**La PWA se actualiza sola.** `index.html`, `sw.js`, `registerSW.js` y el
manifest van con `Cache-Control: no-cache`; antes los teléfonos se quedaban
con la versión vieja hasta recargar a mano.

**Ningún contenedor de la aplicación corre como root.**
- Frontend: nginx corre entero como el usuario `nginx`, también el proceso
  maestro, y escucha en `$PORT` (8080 por defecto, que no exige privilegios).
- Backend: imagen en dos etapas (el compilador solo en la que instala
  dependencias) y la aplicación como el usuario `app`, que puede leer el
  código pero no modificarlo. El contenedor arranca como root solo para dejar
  la carpeta de fotos (`STATIC_DIR`) a nombre de `app` cuando es un volumen de
  root, como en Railway, y baja a `app` antes de migrar o atender
  (`backend/entrypoint.sh`).

**El proxy en el que se confía es explícito.** Uvicorn solo acepta los
`X-Forwarded-For` y `X-Forwarded-Proto` de quien diga `FORWARDED_ALLOW_IPS`.
Sin definirla confía solo en `127.0.0.1`; en Railway, donde el backend solo es
alcanzable por su proxy, confía en ese proxy (`*`). Antes era `*` fijo, y con
el backend expuesto sin proxy cualquiera podía falsear su IP en la bitácora y
saltarse los límites de frecuencia.

**Producción no arranca sin protección.** Con `ENVIRONMENT=production`, si la
conexión del backend es de superusuario o dueña de la bitácora (o no se puede
comprobar), el backend se niega a arrancar y dice qué cambiar
(`app/core/arranque.py`). Antes solo lo avisaba la pantalla de la bitácora.

**TLS hacia la base cuando haga falta.** `DB_SSL_MODE` (`require`,
`verify-full`, ...) lo exige en las tres conexiones: la del backend, la
síncrona y la del propietario. Se deja vacío mientras la base esté en la misma
red privada que el backend.

**Cómo se comprueba.** El job "Imágenes de producción" del CI construye y
arranca las dos imágenes con `scripts/verificar-cabeceras-frontend.sh` y
`scripts/verificar-imagen-backend.sh`, que también se pueden correr en local.

## Rotación de llaves

Hay dos llaves y se rotan por separado: `SECRET_KEY` firma los JWT y
`CLAVE_FIRMA_ARCHIVOS` firma los enlaces a las fotos. El backend no arranca si
son iguales.

**Cuándo rotarlas:**
- en cuanto una aparezca donde no debe (el repositorio, un log, un chat, una
  captura de pantalla);
- cuando deje el equipo alguien que tuvo acceso a las variables de Railway;
- y, aunque no pase nada de eso, una vez por semestre.

**Cómo:**
1. Genera el valor nuevo en tu propia terminal, no en un chat ni en un
   documento compartido:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
2. En Railway, servicio **Backend** → **Variables**, reemplaza el valor. Los
   servicios Cron que la usen por referencia (`${{Backend.SECRET_KEY}}`) toman
   el valor nuevo solos; si alguno la tiene copiada, cámbiala también ahí.
3. Railway vuelve a desplegar el backend con el valor nuevo.
4. Comprueba que el backend arrancó (`/health`) y que puedes iniciar sesión.

**Qué se invalida:**

| Llave | Efecto de rotarla | A quién avisar |
|---|---|---|
| `SECRET_KEY` | Todas las sesiones abiertas dejan de valer: cada usuario vuelve a la pantalla de login con el aviso de sesión vencida. Las contraseñas no cambian | A todo el equipo, y fuera de la jornada de los técnicos para no cortarles una tarea a medias |
| `CLAVE_FIRMA_ARCHIVOS` | Los enlaces a fotos ya entregados dejan de abrir; la pantalla pide uno nuevo al recargar. Nadie pierde su sesión | A nadie: no se nota |

Nunca se reutiliza un valor anterior.

## Lo que esto no cubre

Conviene tenerlo claro para no dar por resuelto lo que no lo está:

- **Tráfico cifrado hacia la base.** La conexión backend↔Postgres va en claro
  dentro de la red interna de Docker. Es aceptable porque esa red no sale del
  host; en un despliegue donde la base viva en otra máquina hay que activar TLS
  en Postgres (`ssl=on` con certificados), exigir `hostssl` en `pg_hba.conf` y
  definir `DB_SSL_MODE=verify-full` en el backend.
- **Copias de seguridad fuera del host.** Ya existe el procedimiento y está
  probado (ver «Copias de seguridad»), pero los archivos se quedan donde los
  deja el cron. Un ransomware o un `docker volume rm` que alcance también esa
  carpeta se lleva la base y sus respaldos a la vez: hay que copiarlos a otro
  sitio, y eso es un paso de operación que nadie ha montado todavía.
- **Cifrado en reposo.** El volumen de Postgres no está cifrado. Quien tenga
  acceso físico o administrativo al host puede leerlo.
- **Contadores en memoria.** Los límites de frecuencia viven en el proceso. Con
  un solo worker de uvicorn (el caso actual) son exactos; con varias réplicas
  cada una lleva su cuenta y habría que mover el estado a Redis.
- **Dependencias de desarrollo.** La auditoría que bloquea mira solo lo que
  llega a producción (`--omit=dev`), para que un aviso en una herramienta de
  pruebas no frene un PR urgente. Hoy están limpias, pero si aparece uno lo
  avisa Dependabot, no el CI.
- **Bitácora sin rol mínimo.** Si el backend se conecta como superusuario (sin
  `APP_DB_USER`, el caso de un Railway sin configurar), la base no puede
  impedirle alterar la bitácora: queda solo la detección por la cadena. La
  pantalla de la bitácora lo avisa.
- **Borrado del final de la bitácora, entre dos anclas.** La cadena detecta
  filas alteradas, filas que faltan en medio y el borrado del comienzo, pero no
  que alguien con acceso de superusuario borre las últimas filas. Desde
  HU-S10-05, `python mantenimiento.py anclar` deja una vez al día el id y el
  hash de la última fila en el log del servicio, fuera de la base, y
  `verificar-bitacora --ancla <id>:<hash>` dice si esa fila desapareció o
  cambió. Lo que queda sin cubrir es lo escrito después del último ancla, y que
  quien tenga acceso al log también lo pueda alterar: un almacenamiento
  inmutable externo cerraría las dos cosas.
- **IP en la bitácora en Railway.** Ahí uvicorn confía en cualquier
  `X-Forwarded-For` (`FORWARDED_ALLOW_IPS=*`), porque Railway no publica la IP
  de su proxy y el backend solo es alcanzable a través de él. Si algún día se
  expusiera el backend por otro camino, hay que fijar esa variable a la IP del
  proxy.
- **`'unsafe-inline'` en los estilos.** React y Leaflet ponen estilos en el
  atributo `style`, así que la CSP los permite. Los scripts no: es lo que
  importa para el robo de sesión.
