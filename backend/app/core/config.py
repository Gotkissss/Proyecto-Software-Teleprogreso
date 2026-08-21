import re
import secrets
from typing import List, Union

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


# Valores que aparecen en tutoriales, plantillas y copy-paste. Si alguno de
# estos termina siendo la SECRET_KEY, cualquiera puede firmar un JWT de admin
# y entrar como si fuera dueño del sistema: la base de datos queda abierta sin
# necesidad de tocar Postgres. Por eso el arranque se aborta.
SECRETOS_PROHIBIDOS = {
    "changeme", "change_me", "cambiar", "cambiame", "secret", "secreto",
    "supersecret", "mysecretkey", "your-secret-key", "your_secret_key",
    "clave", "password", "123456", "admin", "test", "dev", "development",
    "teleprogreso", "string",
}

# Longitud mínima de la llave de firma. Con HS256 la firma no es más fuerte que
# la llave: 32 caracteres aleatorios es el piso razonable para que no se pueda
# romper por fuerza bruta fuera de línea.
LONGITUD_MINIMA_SECRET_KEY = 32


class Settings(BaseSettings):
    # ── Entorno ──────────────────────────────────────────────────────────────
    # "development" | "production" | "test". Endurece o relaja comprobaciones
    # que solo tienen sentido en un despliegue real (documentación pública de
    # la API, exigencia de host confiable, etc.).
    ENVIRONMENT: str = "development"

    # Base de datos
    DATABASE_URL: str
    DATABASE_URL_SYNC: str

    # ── Pool y límites de la conexión a Postgres ─────────────────────────────
    # Un pool acotado evita que una avalancha de peticiones abra cientos de
    # conexiones y deje al motor sin cupo (una caída de servicio trivial de
    # provocar si el pool es ilimitado).
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 5
    DB_POOL_TIMEOUT: int = 30          # segundos esperando un hueco en el pool
    DB_POOL_RECYCLE: int = 1800        # recicla conexiones cada 30 min
    # Techos que se aplican del lado del servidor: una consulta que se vaya de
    # las manos se corta sola en vez de bloquear tablas indefinidamente.
    DB_STATEMENT_TIMEOUT_MS: int = 30_000
    DB_LOCK_TIMEOUT_MS: int = 10_000
    DB_IDLE_TX_TIMEOUT_MS: int = 60_000

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # ── Defensa del login ────────────────────────────────────────────────────
    # El login es la única puerta a los datos, así que es donde va a pegar
    # cualquiera que quiera entrar: probar contraseñas hasta acertar. Estos
    # valores acotan cuántos intentos caben en una ventana de tiempo.
    LOGIN_MAX_INTENTOS: int = 5
    LOGIN_VENTANA_SEGUNDOS: int = 300      # 5 minutos
    LOGIN_BLOQUEO_SEGUNDOS: int = 900      # 15 minutos de castigo

    # Límite general por IP para el resto de la API. Es holgado: está para
    # frenar scripts automáticos, no para estorbar al uso normal.
    RATE_LIMIT_POR_MINUTO: int = 240

    # Tamaño máximo de cuerpo aceptado en cualquier petición (MB). Las subidas
    # de imágenes ya se validan en app/services/uploads.py; esto corta el
    # cuerpo antes incluso de leerlo, para que nadie pueda llenar el disco ni
    # la memoria del proceso enviando gigabytes.
    MAX_REQUEST_BODY_MB: int = 10

    # ── Almacenamiento de las imágenes subidas ───────────────────────────────
    # Carpeta donde se escriben las fotos de evidencia y las imágenes de
    # activos, y que main.py publica en /static.
    #
    # Se configura por entorno porque el disco del contenedor es EFÍMERO: en
    # Railway cada deploy (y cada reinicio) arranca un contenedor nuevo y
    # vacío, así que las fotos guardadas dentro de la imagen desaparecen y sus
    # URLs pasan a devolver 404 — la evidencia queda como una foto rota, sin
    # aviso, y ya no hay forma de recuperarla.
    #
    # Apuntando esta variable al punto de montaje de un volumen persistente
    # (p.e. STATIC_DIR=/data/static) los archivos sobreviven a los deploys.
    # Sin definirla se usa `backend/static`, que es lo correcto en local.
    STATIC_DIR: str = ""

    # Zona horaria de la operación. El contenedor corre en UTC, así que sin
    # esto las fechas guardadas (cierre de tarea, entrada, pausas) quedan 6
    # horas adelantadas respecto de lo que ve el usuario, y el trabajo hecho
    # después de las 18:00 se registra con la fecha del día siguiente.
    TIMEZONE: str = "America/Guatemala"

    # Hora local a partir de la cual un técnico sin asistencia genera alerta.
    # Se deja configurable para adaptar la regla a la jornada de Teleprogreso
    # sin modificar el código cuando cambie el horario operativo.
    ALERTA_HORA_LIMITE: str = "08:00"

    # CORS — acepta JSON list o string separado por comas
    BACKEND_CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Dominios que el backend acepta en el header Host. Bloquea los ataques de
    # Host header (envenenamiento de links, cache poisoning). Vacío = sin
    # restricción; en producción se exige que esté definido.
    ALLOWED_HOSTS: Union[List[str], str] = []

    @field_validator("DATABASE_URL", "DATABASE_URL_SYNC", "SECRET_KEY", "ALGORITHM", mode="before")
    @classmethod
    def strip_str(cls, v):
        # Los .env editados en Windows pueden dejar \r al final de cada
        # valor (CRLF); python-jose rechaza un SECRET_KEY con \r.
        return v.strip() if isinstance(v, str) else v

    @field_validator("ALGORITHM")
    @classmethod
    def algoritmo_soportado(cls, v: str) -> str:
        """
        Solo se aceptan algoritmos de firma reales.

        Existe un ataque clásico contra JWT que consiste en pedirle a la
        librería que verifique con `alg: none`, es decir, sin verificar nada.
        Fijar aquí la lista blanca cierra esa puerta desde la configuración,
        además de la lista explícita que ya se pasa al decodificar.
        """
        permitidos = {"HS256", "HS384", "HS512", "RS256", "RS384", "RS512"}
        if v not in permitidos:
            raise ValueError(
                f"ALGORITHM '{v}' no está permitido. Usa uno de: "
                f"{', '.join(sorted(permitidos))}."
            )
        return v

    @field_validator("BACKEND_CORS_ORIGINS", "ALLOWED_HOSTS", mode="before")
    @classmethod
    def parse_lista(cls, v):
        if isinstance(v, str):
            # Si es JSON válido, se parsea; si no, se divide por comas.
            # Robusto ante corchetes sin comillas ("[http://a,http://b]")
            # y ante \r de archivos .env editados en Windows.
            v = v.strip()
            if not v:
                return []
            if v.startswith("["):
                import json
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    v = v.strip("[]")
            return [origin.strip().strip('"\'') for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("BACKEND_CORS_ORIGINS")
    @classmethod
    def cors_sin_comodin(cls, v):
        """
        `allow_origins=["*"]` junto con `allow_credentials=True` significa que
        cualquier página de internet puede llamar a la API con la sesión del
        usuario. Se rechaza de plano.
        """
        if isinstance(v, list) and any(o.strip() == "*" for o in v):
            raise ValueError(
                "BACKEND_CORS_ORIGINS no puede contener '*'. Enumera los "
                "orígenes exactos del frontend, p.ej. "
                '["https://miapp.com","http://localhost:5173"].'
            )
        return v

    @model_validator(mode="after")
    def validar_secretos(self):
        """
        Comprueba que la llave de firma de los JWT sea de verdad un secreto.

        Se hace aquí, al construir la configuración, para que el proceso ni
        siquiera arranque con una llave adivinable. Fallar ruidosamente al
        inicio es mucho mejor que descubrir meses después que los tokens se
        podían falsificar.
        """
        if self.ENVIRONMENT == "test":
            # La suite de pruebas usa llaves de juguete a propósito.
            return self

        clave = self.SECRET_KEY or ""
        motivo = None

        if len(clave) < LONGITUD_MINIMA_SECRET_KEY:
            motivo = (
                f"tiene {len(clave)} caracteres y se requieren al menos "
                f"{LONGITUD_MINIMA_SECRET_KEY}"
            )
        elif clave.lower() in SECRETOS_PROHIBIDOS:
            motivo = "es un valor de ejemplo conocido"
        elif any(p in clave.lower() for p in ("changeme", "your-secret", "your_secret", "cambiar")):
            motivo = "parece una plantilla sin rellenar"
        elif len(set(clave)) < 8:
            motivo = "repite muy pocos caracteres distintos (no es aleatoria)"

        if motivo:
            sugerencia = secrets.token_urlsafe(48)
            raise ValueError(
                f"SECRET_KEY insegura: {motivo}.\n"
                "Con una llave débil cualquiera puede firmar un token de "
                "administrador y leer toda la base de datos.\n"
                "Pon esta línea en tu .env (o genera otra con "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"`):\n"
                f"    SECRET_KEY={sugerencia}"
            )

        return self

    @model_validator(mode="after")
    def validar_produccion(self):
        """Comprobaciones que solo aplican a un despliegue real."""
        if self.ENVIRONMENT != "production":
            return self

        origenes = self.BACKEND_CORS_ORIGINS
        if isinstance(origenes, list):
            inseguros = [o for o in origenes if o.startswith("http://")
                         and not re.match(r"^http://(localhost|127\.0\.0\.1)", o)]
            if inseguros:
                raise ValueError(
                    "En producción los orígenes de CORS deben usar https. "
                    f"Revisa: {', '.join(inseguros)}"
                )

        if not self.ALLOWED_HOSTS:
            raise ValueError(
                "En producción hay que definir ALLOWED_HOSTS con los dominios "
                'desde los que se sirve la API, p.ej. ALLOWED_HOSTS=["api.miapp.com"]. '
                "Sin esto la API responde a cualquier Host, lo que permite "
                "envenenar enlaces y cachés."
            )

        return self

    @property
    def es_produccion(self) -> bool:
        return self.ENVIRONMENT == "production"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
