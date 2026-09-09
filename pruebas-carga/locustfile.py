"""
Pruebas de carga y estrés — Teleprogreso S.A.
=============================================================================
Herramienta: Locust 2.46 (https://locust.io). Se eligió porque el plan de
pruebas se escribe en Python plano —el mismo lenguaje del backend—, no hace
falta compilar nada y da percentiles y fallos por endpoint sin trabajo extra.

Se ejecuta contra el despliegue real de Railway, no contra un entorno local:
lo que interesa medir es lo que va a ver el usuario, incluyendo la latencia de
red y los límites del contenedor.

-----------------------------------------------------------------------------
DOS ESCENARIOS
-----------------------------------------------------------------------------

  UsuarioSupervisor  → CARGA. Simula a las 30 personas que usan el sistema a
                       la vez, con un ritmo humano (3-6 s entre acciones) y
                       recorriendo las pantallas reales del panel.

  GolpeSostenido     → ESTRÉS. Machaca `/health` sin pausas para encontrar el
                       techo del servidor. Se usa ese endpoint porque es el
                       único, junto con `/`, exento del limitador por IP
                       (RUTAS_EXENTAS en app/core/middleware_seguridad.py):
                       así se mide la capacidad del contenedor y no la del
                       limitador.

-----------------------------------------------------------------------------
POR QUÉ SE INICIA SESIÓN UNA SOLA VEZ
-----------------------------------------------------------------------------
El token se pide una vez y lo comparten todos los usuarios virtuales. No es
por comodidad: `POST /auth/login` verifica la contraseña con bcrypt a 12
rondas (~250 ms de CPU cada una, a propósito) y está limitado a 30 intentos
por minuto y por IP. Si cada usuario virtual iniciara sesión por su cuenta, la
prueba mediría el coste del login y el bloqueo antifuerza bruta en lugar de la
operación normal. Una persona real tampoco vuelve a entrar cada 4 segundos:
inicia sesión una vez y navega durante horas.

-----------------------------------------------------------------------------
CÓMO SE CORRE
-----------------------------------------------------------------------------
  # Carga: 30 usuarios, entrando de 5 en 5, durante 2 minutos
  locust -f pruebas-carga/locustfile.py --headless \\
         -u 30 -r 5 -t 2m --csv resultados-carga \\
         --host https://backend-production-6d60.up.railway.app \\
         UsuarioSupervisor

  # Estrés: subir hasta 100 concurrentes contra el endpoint sin limitador
  locust -f pruebas-carga/locustfile.py --headless \\
         -u 100 -r 10 -t 1m --csv resultados-estres \\
         --host https://backend-production-6d60.up.railway.app \\
         GolpeSostenido

Credenciales: se toman de TELEPROGRESO_USUARIO / TELEPROGRESO_CLAVE. Si no
están, usa las del seed documentadas en el README, que son de prueba.
=============================================================================
"""

import logging
import os
import threading

from locust import HttpUser, between, constant, events, tag, task

logger = logging.getLogger(__name__)

USUARIO = os.getenv("TELEPROGRESO_USUARIO", "admin@teleprogreso.com")
CLAVE = os.getenv("TELEPROGRESO_CLAVE", "Admin1234!")

# Token compartido por todos los usuarios virtuales (ver cabecera).
_token: str | None = None
_candado = threading.Lock()


def obtener_token(cliente) -> str | None:
    """Inicia sesión la primera vez que alguien lo necesita; luego reutiliza."""
    global _token
    with _candado:
        if _token is not None:
            return _token

        # catch_response para que un login fallido no se cuente como una
        # petición más del escenario: es preparación, no carga medida.
        with cliente.post(
            "/auth/login",
            json={"correo": USUARIO, "contrasena": CLAVE},
            name="[preparación] POST /auth/login",
            catch_response=True,
        ) as respuesta:
            if respuesta.status_code != 200:
                respuesta.failure(f"login {respuesta.status_code}: {respuesta.text[:200]}")
                logger.error(
                    "No se pudo iniciar sesión (%s). Revisa TELEPROGRESO_USUARIO "
                    "y TELEPROGRESO_CLAVE.", respuesta.status_code,
                )
                return None
            respuesta.success()
            _token = respuesta.json()["access_token"]
            logger.info("Sesión iniciada; el token se reutiliza en toda la prueba.")
            return _token


class UsuarioSupervisor(HttpUser):
    """
    CARGA — un supervisor/admin usando el panel a ritmo humano.

    Los pesos de cada tarea imitan lo que de verdad se mira: el panel y el
    reparto de trabajo se consultan mucho más que la ficha de inventario.
    """

    # Entre 3 y 6 segundos entre acciones. Es lo que tarda una persona en leer
    # una pantalla y decidir; sin esta pausa no se simulan 30 usuarios sino 30
    # bots, y el resultado no se parece a la operación real.
    wait_time = between(3, 6)

    def on_start(self):
        token = obtener_token(self.client)
        if token:
            self.client.headers.update({"Authorization": f"Bearer {token}"})
        else:
            self.environment.runner.quit()

    @task(4)
    def ver_panel(self):
        self.client.get("/metricas/supervisor", name="Panel: métricas")

    @task(3)
    def ver_tareas(self):
        self.client.get("/tareas", name="Reasignación: lista de tareas")

    @task(2)
    def ver_tecnicos(self):
        self.client.get(
            "/empleados/tecnicos/disponibles", name="Panel: carga de técnicos"
        )

    @task(2)
    def ver_empleados(self):
        self.client.get("/empleados", name="Empleados: lista")

    @task(2)
    def ver_alertas(self):
        self.client.get("/alertas?estado=pendiente", name="Alertas: pendientes")

    @task(1)
    def ver_inventario(self):
        self.client.get("/activos/carros", name="Inventario: vehículos")

    @task(1)
    def ver_perfil(self):
        self.client.get("/auth/perfil", name="Perfil: mis datos")


class GolpeSostenido(HttpUser):
    """
    ESTRÉS — sin pausas, para encontrar dónde deja de responder bien.

    Va contra `/health`, que está exento del limitador por IP. Contra
    cualquier otro endpoint esta prueba mediría el limitador (240 req/min por
    IP) y no la capacidad real del servidor.
    """

    wait_time = constant(0)

    @tag("estres")
    @task
    def golpear(self):
        self.client.get("/health", name="Estrés: GET /health")


@events.quitting.add_listener
def _resumen(environment, **_):
    """Deja en el log el veredicto, para no tener que leer el CSV."""
    stats = environment.stats.total
    if stats.num_requests == 0:
        return
    logger.info(
        "RESUMEN: %s peticiones, %s fallos (%.2f%%), p50=%sms p95=%sms "
        "p99=%sms, %.1f req/s",
        stats.num_requests,
        stats.num_failures,
        (stats.num_failures / stats.num_requests) * 100,
        stats.get_response_time_percentile(0.5),
        stats.get_response_time_percentile(0.95),
        stats.get_response_time_percentile(0.99),
        stats.total_rps,
    )
