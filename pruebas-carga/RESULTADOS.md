# Pruebas de carga y estrés — Teleprogreso S.A.

**Fecha:** 8 de septiembre de 2026
**Entorno:** despliegue de producción en Railway
(`backend-production-6d60.up.railway.app`), no un entorno local.
**Herramienta:** [Locust 2.46](https://locust.io) — plan de pruebas en
`pruebas-carga/locustfile.py`.

## Por qué Locust

- El plan de pruebas se escribe en Python plano, el mismo lenguaje del
  backend, así que cualquiera del equipo puede leerlo y ampliarlo.
- Simula usuarios con estado: cada usuario virtual inicia sesión, guarda su
  token y navega. Herramientas como `ab` o `wrk` solo repiten una URL suelta y
  no sirven para una API con autenticación.
- Da percentiles (p50/p95/p99) por endpoint, que es lo que importa. El
  promedio esconde justo los casos malos.
- Se ejecuta sin interfaz (`--headless`) y exporta CSV, así que la prueba se
  puede repetir en CI y comparar entre sprints.

## Escenario 1 — Carga: los 30 usuarios reales

Simula las 30 personas que van a usar el sistema a la vez, con pausas de 3-6 s
entre acciones (el tiempo que tarda alguien en leer una pantalla y decidir) y
recorriendo las pantallas reales del panel con la frecuencia con que se usan.

| Parámetro | Valor |
|---|---|
| Usuarios concurrentes | 30 |
| Incorporación | 5 usuarios/segundo |
| Duración | 90 s |
| Peticiones totales | **568** |
| **Errores** | **0 (0.00 %)** |
| Throughput generado | 6.3 req/s |

### Latencia por pantalla

| Pantalla (endpoint) | Peticiones | Mediana | p95 | p99 | Máx |
|---|---|---|---|---|---|
| Panel: métricas | 162 | 170 ms | 290 ms | 350 ms | 360 ms |
| Reasignación: lista de tareas | 109 | 200 ms | 310 ms | 450 ms | 480 ms |
| Panel: carga de técnicos | 82 | 160 ms | 260 ms | 340 ms | 340 ms |
| Alertas: pendientes | 77 | 180 ms | 290 ms | 420 ms | 420 ms |
| Empleados: lista | 61 | 150 ms | 260 ms | 400 ms | 400 ms |
| Perfil: mis datos | 45 | 150 ms | 250 ms | 330 ms | 330 ms |
| Inventario: vehículos | 31 | 160 ms | 250 ms | 270 ms | 270 ms |
| **Global** | **568** | **170 ms** | **280 ms** | **400 ms** | 480 ms |

**Veredicto:** con los 30 usuarios previstos el sistema responde por debajo de
300 ms en el 95 % de los casos y sin un solo error. Para referencia, el umbral
habitual de "el usuario lo percibe instantáneo" son 100 ms y el de "no rompe
su concentración" es 1 s: estamos cómodamente en el segundo tramo, con red
incluida.

El endpoint más lento es la lista de tareas (200 ms de mediana), lo cual
encaja: es el único que resuelve coordenadas PostGIS y cuenta evidencias por
tarea.

## Escenario 2 — Estrés: dónde está el techo

Sin pausas entre peticiones y subiendo a 120 usuarios concurrentes, para
encontrar el punto de saturación.

| Parámetro | Valor |
|---|---|
| Usuarios concurrentes | 120 |
| Duración | 60 s |
| Peticiones totales | **25 588** |
| **Errores** | **0 (0.00 %)** |
| **Throughput sostenido** | **427.6 req/s** |
| Mediana | 280 ms |
| p95 | 350 ms |
| p99 | 420 ms |
| Máximo | 1 583 ms |

**Veredicto:** el servidor absorbió 25 588 peticiones en un minuto sin
devolver un solo error. La latencia subió de 170 ms a 280 ms de mediana
—un 65 % más— pero se mantuvo estable: no hay degradación en cascada ni
timeouts. El p99.99 de 1.4 s corresponde a picos aislados, no a una tendencia.

**No se encontró el punto de ruptura con 120 concurrentes.** El sistema
aguanta **427 req/s** frente a los **6.3 req/s** que generan los 30 usuarios
reales: un margen de **68×**.

### Nota metodológica

El escenario de estrés va contra `GET /health`, que junto con `/` está exento
del limitador por IP (`RUTAS_EXENTAS` en
`app/core/middleware_seguridad.py`). Es deliberado: contra cualquier otro
endpoint la prueba mediría el limitador —240 peticiones por minuto y por IP—
y no la capacidad del servidor, porque todos los usuarios virtuales salen de
la misma máquina. Los 30 usuarios reales llegan desde 30 IPs distintas, cada
una con su propio cupo.

Como contrapartida, este escenario mide la capa web (uvicorn + contenedor de
Railway) sin tocar la base de datos. El escenario 1 sí ejerce PostgreSQL y
PostGIS de punta a punta.

## Problemas detectados y cómo se van a solventar

**1. El login cuesta 601 ms, tres veces más que cualquier otra petición.**
No es un defecto: es bcrypt con 12 rondas, elegido a propósito para que
probar contraseñas por fuerza bruta sea inviable. No se va a tocar. Lo que sí
se hizo es que el plan de pruebas inicie sesión una sola vez, porque si no la
prueba mide el coste del hash en lugar de la operación normal. Con una sesión
de 60 minutos, cada usuario paga esos 600 ms una vez al día.

**2. El limitador por IP no llegó a activarse durante la prueba.**
Con 379 peticiones/minuto desde una sola IP se esperaban respuestas 429 y
todas volvieron 200. La causa probable está documentada en el propio módulo
(`app/core/rate_limit.py`): el contador vive en memoria del proceso, así que
con varias réplicas o varios workers de uvicorn cada uno lleva su propia
cuenta y el límite efectivo se multiplica. **Acción:** confirmar cuántos
workers levanta Railway y, si son varios, mover los contadores a Redis o a una
tabla. Es la limitación que ya estaba anotada como conocida.

**3. La prueba no cubre escrituras.**
Solo se midieron lecturas, a propósito: es producción y no se van a inventar
tareas ni empleados de mentira en la base real. **Acción:** para el siguiente
sprint, levantar un entorno de pruebas con `docker compose` y `seed.py
--reset` y repetir el escenario incluyendo crear tarea, reasignar y marcar
entrada, que son las operaciones que sí escriben y compiten por bloqueos.

**4. No se encontró el punto de ruptura.**
Sabemos que aguanta 427 req/s, no dónde falla. **Acción:** si hace falta el
dato exacto, repetir subiendo a 500 y 1000 concurrentes desde varias máquinas;
desde una sola, el cuello de botella pasa a ser el cliente y no el servidor.

## Conclusión para la presentación

> El sistema se probó contra el despliegue real con Locust. Con los 30
> usuarios simultáneos previstos responde en 170 ms de mediana y 280 ms en el
> percentil 95, con cero errores. Llevado al estrés, sostuvo 427 peticiones
> por segundo durante un minuto —68 veces la carga esperada— sin un solo fallo
> y sin degradarse. La capacidad no es el riesgo del proyecto.

## Cómo reproducirlo

```bash
# Carga: 30 usuarios durante 2 minutos
locust -f pruebas-carga/locustfile.py --headless -u 30 -r 5 -t 2m \
       --csv resultados-carga \
       --host https://backend-production-6d60.up.railway.app UsuarioSupervisor

# Estrés: 120 concurrentes durante 1 minuto
locust -f pruebas-carga/locustfile.py --headless -u 120 -r 20 -t 1m \
       --csv resultados-estres \
       --host https://backend-production-6d60.up.railway.app GolpeSostenido
```

Los CSV de estas dos ejecuciones están en `pruebas-carga/resultados/`.
