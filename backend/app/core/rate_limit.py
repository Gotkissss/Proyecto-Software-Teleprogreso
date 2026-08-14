"""
Control de frecuencia de peticiones y de intentos de login.
-----------------------------------------------------------------------------
Contexto: la base de datos ya no es alcanzable desde fuera del contenedor, así
que el único camino que le queda a un atacante es la API. Y de la API, el único
endpoint que entrega credenciales válidas es `POST /auth/login`. Sin un freno,
un script puede probar miles de contraseñas por minuto contra una lista de
correos corporativos hasta acertar una; a partir de ahí ya no hay "romper" nada,
simplemente entra por la puerta.

Este módulo pone dos frenos:

  1. `intentos_login` — ventana deslizante por (IP, correo). Tras N fallos se
     bloquea ese par durante un rato. El bloqueo se aplica ANTES de comprobar
     la contraseña, así que no sirve de nada seguir insistiendo.
  2. `limite_general` — tope de peticiones por minuto y por IP para el resto
     de la API, pensado para estorbar a los scripts de raspado sin molestar al
     uso normal de la aplicación.

Limitación conocida y deliberada: el estado vive en memoria del proceso. Con un
solo worker de uvicorn (el caso actual) es exacto. Si algún día se levantan
varios workers o varias réplicas, cada uno llevará su propia cuenta y el límite
efectivo se multiplica por el número de procesos; para ese escenario habría que
mover los contadores a Redis o a una tabla. Aun así, incluso repartido, sigue
recortando el ritmo de un ataque en varios órdenes de magnitud.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock

from app.core.config import settings

# Techo de claves distintas que se guardan en memoria. Sin este límite, alguien
# rotando direcciones IP haría crecer el diccionario hasta agotar la RAM del
# proceso: el propio mecanismo de defensa se convertiría en la vulnerabilidad.
MAX_CLAVES_EN_MEMORIA = 20_000


@dataclass
class _Registro:
    """Marcas de tiempo de los eventos recientes de una clave."""
    eventos: deque[float] = field(default_factory=deque)
    bloqueado_hasta: float = 0.0


class VentanaDeslizante:
    """
    Cuenta eventos por clave dentro de una ventana de tiempo, con bloqueo
    opcional al superar el máximo.

    Se usa un `deque` de marcas de tiempo en vez de un contador simple porque
    un contador con reinicio por ventana fija permite el doble de intentos
    justo en el cambio de ventana.
    """

    def __init__(
        self,
        *,
        maximo: int,
        ventana_segundos: int,
        bloqueo_segundos: int = 0,
    ) -> None:
        self.maximo = maximo
        self.ventana = ventana_segundos
        self.bloqueo = bloqueo_segundos
        self._registros: dict[str, _Registro] = {}
        self._lock = Lock()

    # ── API pública ──────────────────────────────────────────────────────────

    def segundos_de_bloqueo(self, clave: str) -> int:
        """
        Segundos que le quedan a la clave antes de poder reintentar.
        0 significa que puede continuar.
        """
        ahora = time.monotonic()
        with self._lock:
            registro = self._registros.get(clave)
            if registro is None:
                return 0
            if registro.bloqueado_hasta > ahora:
                return int(registro.bloqueado_hasta - ahora) + 1
            return 0

    def registrar(self, clave: str) -> int:
        """
        Anota un evento. Devuelve los segundos de bloqueo si con este evento se
        superó el máximo permitido, o 0 si todavía hay margen.
        """
        ahora = time.monotonic()
        with self._lock:
            self._purgar(ahora)
            registro = self._registros.setdefault(clave, _Registro())

            if registro.bloqueado_hasta > ahora:
                return int(registro.bloqueado_hasta - ahora) + 1

            registro.eventos.append(ahora)
            self._descartar_antiguos(registro, ahora)

            # `>=` y no `>`: con LOGIN_MAX_INTENTOS=5, el quinto fallo ya
            # cierra la puerta, no el sexto.
            if len(registro.eventos) >= self.maximo:
                if self.bloqueo:
                    registro.bloqueado_hasta = ahora + self.bloqueo
                    registro.eventos.clear()
                    return self.bloqueo
                # Sin bloqueo configurado: se rechaza solo esta petición y se
                # espera a que la ventana avance sola.
                return max(1, int(self.ventana - (ahora - registro.eventos[0])))

            return 0

    def limpiar(self, clave: str) -> None:
        """Borra el historial de una clave (se llama tras un login correcto)."""
        with self._lock:
            self._registros.pop(clave, None)

    # ── Interno ──────────────────────────────────────────────────────────────

    def _descartar_antiguos(self, registro: _Registro, ahora: float) -> None:
        limite = ahora - self.ventana
        while registro.eventos and registro.eventos[0] < limite:
            registro.eventos.popleft()

    def _purgar(self, ahora: float) -> None:
        """Elimina claves sin actividad reciente para acotar la memoria."""
        if len(self._registros) < MAX_CLAVES_EN_MEMORIA:
            return
        limite = ahora - self.ventana
        muertas = [
            clave
            for clave, registro in self._registros.items()
            if registro.bloqueado_hasta <= ahora
            and (not registro.eventos or registro.eventos[-1] < limite)
        ]
        for clave in muertas:
            del self._registros[clave]

        # Si aun así sigue lleno (ataque activo desde muchísimos orígenes), se
        # vacía por completo: perder precisión es preferible a quedarse sin
        # memoria. El límite sigue aplicándose sobre las claves nuevas.
        if len(self._registros) >= MAX_CLAVES_EN_MEMORIA:
            self._registros.clear()


# ── Instancias que usa la aplicación ─────────────────────────────────────────

# Fuerza bruta contra el login, por (IP, correo).
intentos_login = VentanaDeslizante(
    maximo=settings.LOGIN_MAX_INTENTOS,
    ventana_segundos=settings.LOGIN_VENTANA_SEGUNDOS,
    bloqueo_segundos=settings.LOGIN_BLOQUEO_SEGUNDOS,
)

# Segunda red, esta vez solo por correo y con un umbral mucho más alto.
#
# Por qué hace falta: el límite por (IP, correo) se esquiva repartiendo el
# ataque entre muchas direcciones, y detrás de un proxy la IP de origen puede
# venir de una cabecera que el cliente controla. Este contador ignora el origen
# y mira solo cuántos fallos acumula una cuenta concreta.
#
# El umbral es 10 veces más alto a propósito: si fuera bajo, cualquiera podría
# dejar fuera de servicio a un empleado real simplemente fallando su contraseña
# adrede. Con este número, una persona normal nunca lo alcanza, pero un ataque
# automatizado sí, y muy rápido.
intentos_login_por_correo = VentanaDeslizante(
    maximo=settings.LOGIN_MAX_INTENTOS * 10,
    ventana_segundos=settings.LOGIN_VENTANA_SEGUNDOS,
    bloqueo_segundos=settings.LOGIN_BLOQUEO_SEGUNDOS,
)

# Tercera red: intentos de login por IP, contando TODOS los intentos y no solo
# los fallidos.
#
# Los dos contadores de arriba miran combinaciones concretas, así que se
# esquivan probando un correo distinto en cada petición. Este no: pone un techo
# a cuántas veces por minuto una misma IP puede pedir que se verifique una
# contraseña. Importa porque cada verificación cuesta ~250 ms de CPU (bcrypt a
# 12 rondas, a propósito): sin este tope, unas pocas peticiones por segundo
# bastarían para dejar al backend sin capacidad de atender a nadie más.
peticiones_login_por_ip = VentanaDeslizante(
    maximo=30,
    ventana_segundos=60,
)

# Freno general de la API, por IP.
limite_general = VentanaDeslizante(
    maximo=settings.RATE_LIMIT_POR_MINUTO,
    ventana_segundos=60,
)


def ip_cliente(request) -> str:
    """
    IP de origen de la petición.

    Se usa `request.client.host` y NO el header X-Forwarded-For crudo: ese
    header lo puede escribir cualquiera, y confiar en él permitiría saltarse
    todos los límites simplemente mandando una IP distinta en cada intento.
    Cuando la app corre detrás del proxy de Railway, uvicorn arranca con
    `--proxy-headers`, y es uvicorn quien traduce el header a `client.host`
    tras validarlo. Así el valor es fiable en los dos escenarios.
    """
    return request.client.host if request.client else "desconocido"
