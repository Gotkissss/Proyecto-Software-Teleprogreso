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

## Las cuatro capas

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

Si esas dos variables quedan vacías, todo sigue funcionando exactamente igual
que antes con el usuario de siempre: la mejora es opcional para no romper un
entorno que ya está corriendo.

- Volumen nuevo → el rol se crea solo (`backend/db/init/10_rol_aplicacion.sh`).
- Base que ya existe → aplica una vez `backend/db/aplicar_rol_aplicacion.sql`
  (instrucciones dentro del archivo) y luego pon las variables en el `.env`.

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

**Cabeceras.** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP
restrictiva con `sandbox` (importante para `/static`, donde se sirven imágenes
subidas por usuarios) y HSTS en producción.

**Documentación de la API.** `/docs`, `/redoc` y `/openapi.json` dejan de
publicarse cuando `ENVIRONMENT=production`: son un mapa completo de la
superficie de ataque.

**Secretos por contenedor.** Antes los tres servicios recibían el `.env`
entero: el contenedor de la base conocía la `SECRET_KEY` y el de React conocía
la contraseña de Postgres. Ahora cada uno recibe solo lo suyo.

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
   que el backend deje de conectarse como superusuario.
3. Levanta normalmente con `docker compose up -d`.

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
- **Dependencias.** `fastapi==0.111.0` arrastra `starlette 0.37.2` y
  `python-multipart 0.0.9`, ambos con avisos de denegación de servicio al
  procesar formularios. El corte por tamaño de cuerpo lo mitiga en parte, pero
  la solución real es subir de versión; se dejó fuera de este cambio porque
  toca el framework y requiere probar la aplicación entera.
