# Proyecto-Software-Teleprogreso-S.A.

Proyecto de Ingeniería de Software para el desarrollo de una aplicación de supervisión de personal y generación de reportes para Teleprogreso S.A.

## 👥 Integrantes del Equipo

| Nombre | Carné |
|---|---|
| Harry Méndez | 24089 |
| Juan Gualim | 24852 |
| Blanca Raxón | 24960 |
| Joel Nerio | 24253 |
| Wilson Peña | 24760 |
| Diego Quixchán | 24903 |

## 📂 Estructura del Repositorio

### 📁 Avances 1
Contiene los documentos y entregables del primer avance del proyecto:

### 📁 Avances 2
Contiene los documentos, enlaces y entregables del segundo avance del proyecto

### 📁 Corte 1
Materiales y entregables del primer corte

### 📁 Corte 2
Materiales y entregables del segundo corte

### 📁 Scrum
Documentación relacionada con la metodología Scrum

```
├── backend/          # FastAPI — modelos, rutas, seguridad, migraciones
├── frontend/         # React/Vite — páginas, componentes, servicios API
├── Avances 1/        # Entregables del primer avance
├── Avances 2/        # Entregables del segundo avance
├── Corte 1/          # Materiales del primer corte
├── Corte 2/          # Materiales del segundo corte
└── Scrum/            # Documentación de metodología Scrum
```

## 🏢 Sobre Teleprogreso S.A.

Teleprogreso S.A. es una empresa ubicada en Fraijanes que brinda servicios de internet por fibra óptica y televisión por cable, ofrecidos a sus clientes mediante un pago mensual. Este tipo de empresas se conocen como ISP (Internet Service Provider), ya que se encargan de proveer acceso a internet y servicios de conectividad a hogares y negocios.

## 📋 Descripción del Proyecto

Este proyecto consiste en el desarrollo de una aplicación web/móvil para la supervisión de personal y generación de reportes automatizados, con el objetivo de optimizar los procesos de gestión de recursos humanos en Teleprogreso S.A.### Funcionalidades Principales
- Supervisión de personal en tiempo real
- Generación automática de reportes
- Gestión de asistencia y horarios
- Dashboard de métricas y KPIs

## 🚀 Stack tecnológico
 
**Backend:** FastAPI + PostgreSQL/PostGIS + SQLAlchemy (async) + Alembic + JWT  
**Frontend:** React 18 + Vite + React Router + Axios + CSS Modules (PWA)  
**Infraestructura:** Docker Compose
 
## ✨ Funcionalidades
 
- **Técnicos (móvil/PWA):** ruta diaria con prioridades, control de asistencia (entrada/salida), pausas operativas con countdown, mapa de ruta
- **Supervisores (desktop):** dashboard con métricas en tiempo real, gestión de alertas operativas, reasignación de tareas entre técnicos
- **Gerencia (admin y gerente):** pantalla de Reportes con indicadores y su variación contra el periodo anterior, tendencia de horas, tareas y pausas por día o semana, productividad por técnico, resumen por empleado con detalle de cada persona y exportación a Excel con los mismos filtros. El gerente entra directo a esta pantalla
- **Autenticación:** JWT con control de acceso por rol (admin, supervisor, técnico, gerente)
## 🛠️ Levantar el proyecto
 
```bash
# 1. Copiar y completar variables de entorno
cp .env.example .env
 
# 2. Levantar todos los servicios
docker compose up --build
```
 
| Servicio | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| Docs (Swagger) | http://localhost:8000/docs |
 
Cuando cambian las dependencias del frontend (`package-lock.json`), levanta con
`docker compose up --build -V`. El contenedor guarda `node_modules` en un
volumen aparte y, sin `-V`, sigue usando los paquetes de antes aunque la
imagen ya traiga los nuevos.

### Cuentas de demostración

El seed automático crea estas cuentas para poder probar cada rol:

| Rol | Correo |
|---|---|
| Admin | admin@teleprogreso.com |
| Supervisor | supervisor@teleprogreso.com |
| Gerente | gerente@teleprogreso.com |
| Técnico | tecnico@teleprogreso.com |

El seed crea además tres técnicos más (`maria.lopez@`, `diego.morales@`,
`ana.castillo@`) y uno inactivo (`pedro.hernandez@`) para poder probar el
filtro de estado.

**Las contraseñas no se publican en este repositorio.**

- **En local** (`docker compose`, `ENVIRONMENT=development`): son las que están
  escritas en `backend/seed.py`. Sirven solo para desarrollo: con
  `ENVIRONMENT=production` el seed se niega a usarlas.
- **En el despliegue (Railway):** las contraseñas de las cuentas de demo las
  fijó el equipo y se comparten por un canal privado. Si las necesitas,
  pídelas ahí; no las pongas en el repositorio, en un PR ni en un chat público.

Cómo se controlan los datos de demo en un despliegue (`SEMBRAR_DEMO`,
`CONTRASENA_DEMO`) y cómo retirarlos cuando la empresa pase a usar datos
reales está en `SEGURIDAD.md`, sección «Cuentas y contraseñas».

## 🗄️ Repoblar la base de datos

`seed.py` corre en cada arranque (en docker-compose, dentro del servicio
`migraciones`, que aplica las migraciones, siembra, purga y termina antes de
que arranque el backend), pero es **idempotente**: si ya hay empleados no toca
nada, para no pisar datos de trabajo.

Para borrar todo y volver a sembrar el escenario completo (empleados, tareas
con coordenadas, vehículos, herramientas, inventario, asistencia de 14 días,
pausas, ubicaciones GPS y evidencias):

```bash
docker compose run --rm migraciones python seed.py --reset
```

(Con el servicio `migraciones` y no con `backend`: el reset necesita al
propietario del esquema, y el backend se conecta con el rol de la app.)

En local también sirve tirar el volumen:

```bash
docker compose down -v
```

El reset hace `TRUNCATE ... RESTART IDENTITY CASCADE` sobre todas las tablas
de datos y **no toca `alembic_version`** (el esquema lo siguen gobernando las
migraciones) **ni la bitácora de auditoría**, que es de solo inserción.

### En Railway

Railway no deja borrar el volumen de Postgres, así que el reset se hace a mano
desde la CLI, **una sola vez**, desde el directorio `backend/`:

```bash
railway run python seed.py --reset
```

`SEED_RESET=true` **ya no funciona en producción**: la variable vive en la
configuración del servicio y el contenedor la relee en cada arranque, así que
dejarla puesta por olvido convertía cada push en un borrado completo de la
base. Ahora `seed.py` la ignora cuando `ENVIRONMENT=production` y lo avisa en
los *Deploy Logs*; el flag `--reset` sigue funcionando en todos los entornos
porque es una ejecución puntual y deliberada, no algo que se repita solo.

Fuera de producción (local, `ENVIRONMENT=development`) la variable se sigue
respetando, y en local además está `docker compose down -v`.
 

## 🛡️ Bitácora de auditoría y mantenimiento

Todo cambio de datos, login fallido, 403 y consulta de datos sensibles queda
en la bitácora de auditoría (HU-S9-03). El admin la consulta en **Bitácora**
(`/supervisor/bitacora`): filtros, detalle del antes/después de cada campo,
exportación a Excel y un aviso si la cadena de hashes está rota. Detalles de
cómo se protege en `SEGURIDAD.md`.

Comandos (desde `backend/`, o con `docker compose run --rm migraciones ...`):

```bash
python mantenimiento.py purgar               # retención: tokens, GPS y bitácora
python mantenimiento.py verificar-bitacora   # código 1 si la cadena está rota
```

`purgar` corre en cada arranque. Para que la retención no dependa de los
despliegues, prográmalo una vez al día:

- **Local / servidor propio** (cron del host):
  `0 3 * * * cd /ruta/al/proyecto && docker compose run --rm migraciones python mantenimiento.py purgar`
- **Railway:** un servicio con la misma imagen del backend, *Cron Schedule*
  `0 9 * * *` (03:00 en Guatemala) y *Start Command*
  `python mantenimiento.py purgar`.

Variables: `RETENCION_BITACORA_DIAS` y `RETENCION_UBICACIONES_DIAS` (90 por
defecto). En un despliegue de un solo contenedor con rol de privilegio mínimo
define `DATABASE_URL_MIGRACIONES` con el propietario del esquema: con ella
migran Alembic, el seed y la purga (la bitácora solo la puede purgar su dueño).

## 📷 Fotos de evidencia: dónde se guardan

Las fotos de evidencia y las imágenes de activos se escriben en disco y se
sirven en `/static/...`. La carpeta sale de la variable `STATIC_DIR`; si no se
define, se usa `backend/static`, que es lo correcto en local y en
`docker compose`.

**En Railway hay que apuntarla a un volumen.** El disco del contenedor es
efímero: cada deploy y cada reinicio arrancan un contenedor nuevo y vacío, así
que sin volumen todas las fotos subidas hasta ese momento desaparecen y sus
URLs pasan a devolver 404. En la pantalla se ve como una evidencia rota, sin
mensaje de error, y el archivo ya no se puede recuperar.

Configuración, una sola vez, en el servicio del **backend**:

1. Pestaña **Variables** → añadir `STATIC_DIR` con el valor `/data/static`.
2. Pestaña **Settings** → **Volumes** → **Add Volume**, con *Mount path*
   `/data`.
3. Redesplegar.

El backend crea `/data/static` al arrancar si no existe, así que no hace falta
preparar nada dentro del volumen.

Las fotos subidas **antes** de montar el volumen ya no están: sus registros en
la base siguen apuntando a archivos que se perdieron, y hay que volver a
subirlas. Desde la pantalla se reconocen porque ahora avisan con "No se pudo
cargar la foto" en lugar de dejar una miniatura rota.