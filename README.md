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
 
Credenciales de prueba (seed automático):
 
| Rol | Correo | Contraseña |
|---|---|---|
| Admin | admin@teleprogreso.com | Admin1234! |
| Supervisor | supervisor@teleprogreso.com | Super1234! |
| Gerente | gerente@teleprogreso.com | Gerente1234! |
| Técnico | tecnico@teleprogreso.com | Tecnico1234! |

El seed crea además tres técnicos más (`maria.lopez@`, `diego.morales@`,
`ana.castillo@`, todos con `Tecnico1234!`) y uno inactivo
(`pedro.hernandez@`) para poder probar el filtro de estado.

## 🗄️ Repoblar la base de datos

`seed.py` corre en cada arranque del backend, pero es **idempotente**: si ya
hay empleados no toca nada, para no pisar datos de trabajo.

Para borrar todo y volver a sembrar el escenario completo (empleados, tareas
con coordenadas, vehículos, herramientas, inventario, asistencia de 14 días,
pausas, ubicaciones GPS y evidencias):

```bash
docker compose exec backend python seed.py --reset
```

En local también sirve tirar el volumen:

```bash
docker compose down -v
```

El reset hace `TRUNCATE ... RESTART IDENTITY CASCADE` sobre todas las tablas
de datos y **no toca `alembic_version`**: el esquema lo siguen gobernando las
migraciones.

### En Railway

Railway no deja borrar el volumen de Postgres, así que el reset se dispara con
una variable de entorno:

1. En el servicio del **backend** → *Variables* → agregar `SEED_RESET=true`.
2. Hacer push a la rama que Railway despliega. Al arrancar, el contenedor
   corre `alembic upgrade head` y luego `python seed.py`, que ve la variable,
   vacía la base y la resiembra.
3. Revisar los *Deploy Logs*: debe aparecer `🗑️ SEED_RESET activo` seguido de
   `🎉 Seed completado exitosamente`.
4. **Volver a poner `SEED_RESET=false`** (o eliminar la variable). Si se queda
   en `true`, cada reinicio del contenedor borrará la base otra vez.

> Alternativa sin tocar variables: `railway run python seed.py --reset` desde
> el directorio `backend/`.
 
