import logging
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

# Valores de sslmode de libpq; asyncpg acepta los mismos en `ssl`.
MODOS_SSL_BD = ("disable", "allow", "prefer", "require", "verify-ca", "verify-full")

logger = logging.getLogger(__name__)


def motivo_llave_debil(clave: str) -> str | None:
    """
    Por qué una llave de firma no sirve, o None si es aceptable. La usan
    SECRET_KEY y CLAVE_FIRMA_ARCHIVOS: las dos firman algo que el cliente no
    debe poder fabricar.
    """
    if len(clave) < LONGITUD_MINIMA_SECRET_KEY:
        return (
            f"tiene {len(clave)} caracteres y se requieren al menos "
            f"{LONGITUD_MINIMA_SECRET_KEY}"
        )
    if clave.lower() in SECRETOS_PROHIBIDOS:
        return "es un valor de ejemplo conocido"
    if any(p in clave.lower() for p in ("changeme", "your-secret", "your_secret", "cambiar")):
        return "parece una plantilla sin rellenar"
    if len(set(clave)) < 8:
        return "repite muy pocos caracteres distintos (no es aleatoria)"
    return None


class Settings(BaseSettings):
    # ── Entorno ──────────────────────────────────────────────────────────────
    # "development" | "production" | "test". Endurece o relaja comprobaciones
    # que solo tienen sentido en un despliegue real (documentación pública de
    # la API, exigencia de host confiable, etc.).
    ENVIRONMENT: str = "development"

    # Base de datos
    DATABASE_URL: str
    DATABASE_URL_SYNC: str
    # Conexión (síncrona, psycopg2) con la que se migra y se purga. Debe ser
    # la del propietario del esquema (POSTGRES_USER), no la del rol de la app:
    # así la bitácora queda de un dueño distinto al que la escribe y el rol de
    # la app no puede desactivar sus triggers ni vaciarla. Vacía = se usa
    # DATABASE_URL_SYNC, como antes (despliegues con un solo usuario).
    DATABASE_URL_MIGRACIONES: str = ""

    # ── Retención de datos (mantenimiento.py purgar) ─────────────────────────
    # Días que se conservan la bitácora de auditoría y los puntos GPS de los
    # técnicos. La purga de la bitácora deja un ancla para no romper la cadena.
    RETENCION_BITACORA_DIAS: int = 90
    RETENCION_UBICACIONES_DIAS: int = 90

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

    # TLS hacia Postgres (HU-S10-06). Vacío = como venga en las URL, que es lo
    # correcto cuando la base vive en la misma red privada que el backend
    # (docker-compose, Railway). Si la base sale de esa red, `require` o
    # `verify-full`: se aplica a las tres conexiones (app, sync y migraciones),
    # así lo heredan el backend, Alembic, el seed y mantenimiento.py.
    DB_SSL_MODE: str = ""

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # ── Firma de las URLs de archivos (HU-S10-02) ────────────────────────────
    # Llave HMAC de los enlaces temporales a las fotos subidas
    # (app/core/archivos_firmados.py). Es otra llave y no SECRET_KEY a
    # propósito: se puede rotar sin cerrar las sesiones, y quien obtenga una
    # no puede fabricar lo que firma la otra. Obligatoria en producción; en
    # desarrollo y pruebas, si falta, se genera una al azar al arrancar.
    CLAVE_FIRMA_ARCHIVOS: str = ""

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
    # activos, y que GET /archivos/... sirve con enlace firmado.
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

    # ── Proxies en los que se confía para leer la IP real (RTF-01 / R1-1) ────
    #
    # Redes (CIDR) desde las que se acepta la cabecera `X-Forwarded-For` para
    # determinar el origen de una petición. Vacío = no se confía en nadie y la
    # IP es la del peer TCP, que es lo correcto cuando no hay proxy delante.
    #
    # Por qué hace falta: detrás del proxy de Railway, `request.client.host` es
    # una dirección de la red interna del proveedor (100.64.0.x) que además
    # cambia en cada petición del mismo usuario. La bitácora la guardaba tal
    # cual, así que la columna IP no identificaba a nadie y la trazabilidad
    # —que es el punto de tener una bitácora— quedaba sin servir.
    #
    # Esto NO es lo mismo que confiar en la cabecera a secas: solo se lee si el
    # peer directo está dentro de una de estas redes, y de la lista se toma la
    # última dirección que NO sea de un proxy confiable. Esa la escribió el
    # proxy a partir de la conexión que él vio, así que un cliente no la puede
    # falsear añadiendo entradas por su cuenta.
    #
    # En Railway se rellena sola (ver `redes_proxy_confiables`): su backend
    # solo es alcanzable a través de su propio proxy.
    PROXIES_CONFIABLES: str = ""

    # Dominios que el backend acepta en el header Host. Bloquea los ataques de
    # Host header (envenenamiento de links, cache poisoning). Vacío = sin
    # restricción; en producción se exige que esté definido.
    ALLOWED_HOSTS: Union[List[str], str] = []

    @field_validator(
        "DATABASE_URL", "DATABASE_URL_SYNC", "DATABASE_URL_MIGRACIONES", "SECRET_KEY", "ALGORITHM",
        "CLAVE_FIRMA_ARCHIVOS",
        mode="before",
    )
    @classmethod
    def strip_str(cls, v):
        # Los .env editados en Windows pueden dejar \r al final de cada
        # valor (CRLF); con el \r dentro, la llave de firma dejaría de ser la
        # misma que la de los demás entornos.
        return v.strip() if isinstance(v, str) else v

    @field_validator("RETENCION_BITACORA_DIAS", "RETENCION_UBICACIONES_DIAS")
    @classmethod
    def retencion_minima(cls, v: int) -> int:
        # Con 0 la purga se llevaría todo lo de hoy, incluida la evidencia de
        # un incidente que se está investigando.
        if v < 1:
            raise ValueError("La retención debe ser de al menos 1 día.")
        return v

    @property
    def url_migraciones(self) -> str:
        """URL síncrona del propietario del esquema (o la de la app si no hay)."""
        return self.DATABASE_URL_MIGRACIONES or self.DATABASE_URL_SYNC

    @property
    def url_migraciones_async(self) -> str:
        """La misma conexión del propietario, con el driver asíncrono (la usa seed.py)."""
        if not self.DATABASE_URL_MIGRACIONES:
            return self.DATABASE_URL
        from sqlalchemy.engine import make_url

        url = make_url(self.DATABASE_URL_MIGRACIONES).set(drivername="postgresql+asyncpg")
        # asyncpg no entiende `sslmode` (es de libpq): se llama `ssl`.
        if "sslmode" in url.query:
            modo = url.query["sslmode"]
            url = url.difference_update_query(["sslmode"]).update_query_dict({"ssl": modo})
        return url.render_as_string(hide_password=False)

    @field_validator("DB_SSL_MODE")
    @classmethod
    def modo_ssl_valido(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v and v not in MODOS_SSL_BD:
            raise ValueError(
                f"DB_SSL_MODE '{v}' no es válido. Usa uno de: {', '.join(MODOS_SSL_BD)}."
            )
        return v

    @model_validator(mode="after")
    def aplicar_ssl_bd(self):
        """DB_SSL_MODE se escribe en las URL: `ssl` para asyncpg, `sslmode` para libpq."""
        if not self.DB_SSL_MODE:
            return self
        from sqlalchemy.engine import make_url

        def con_modo(url: str, parametro: str) -> str:
            if not url:
                return url
            return make_url(url).update_query_dict({parametro: self.DB_SSL_MODE}).render_as_string(
                hide_password=False
            )

        self.DATABASE_URL = con_modo(self.DATABASE_URL, "ssl")
        self.DATABASE_URL_SYNC = con_modo(self.DATABASE_URL_SYNC, "sslmode")
        self.DATABASE_URL_MIGRACIONES = con_modo(self.DATABASE_URL_MIGRACIONES, "sslmode")
        return self

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

        motivo = motivo_llave_debil(self.SECRET_KEY or "")

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
    def validar_clave_archivos(self):
        """
        La llave de las URLs firmadas: obligatoria y fuerte en producción,
        distinta de SECRET_KEY siempre. Sin ella, en desarrollo y pruebas se
        usa una al azar por proceso: los enlaces dejan de valer al reiniciar,
        que fuera de producción no importa.
        """
        sugerencia = secrets.token_urlsafe(48)
        clave = self.CLAVE_FIRMA_ARCHIVOS

        if not clave:
            if self.ENVIRONMENT == "production":
                raise ValueError(
                    "CLAVE_FIRMA_ARCHIVOS es obligatoria en producción: firma "
                    "los enlaces temporales a las fotos subidas.\n"
                    "Define la variable (o genera otra con "
                    "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"`):\n"
                    f"    CLAVE_FIRMA_ARCHIVOS={sugerencia}"
                )
            if self.ENVIRONMENT == "development":
                logger.warning(
                    "CLAVE_FIRMA_ARCHIVOS no está definida: se usa una llave al "
                    "azar y los enlaces a fotos dejan de valer al reiniciar."
                )
            self.CLAVE_FIRMA_ARCHIVOS = sugerencia
            return self

        if clave == self.SECRET_KEY:
            raise ValueError(
                "CLAVE_FIRMA_ARCHIVOS no puede ser igual a SECRET_KEY: son dos "
                "llaves distintas para que una filtrada no comprometa a la otra.\n"
                f"    CLAVE_FIRMA_ARCHIVOS={sugerencia}"
            )

        if self.ENVIRONMENT == "test":
            return self

        motivo = motivo_llave_debil(clave)
        if motivo:
            raise ValueError(
                f"CLAVE_FIRMA_ARCHIVOS insegura: {motivo}.\n"
                "Con una llave débil cualquiera puede fabricar enlaces a las "
                "fotos de evidencia.\n"
                f"    CLAVE_FIRMA_ARCHIVOS={sugerencia}"
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
    def redes_proxy_confiables(self) -> tuple:
        """
        Redes desde las que se cree la cabecera `X-Forwarded-For`.

        Si `PROXIES_CONFIABLES` está vacío y se detecta Railway
        (`RAILWAY_ENVIRONMENT_NAME`, que el proveedor pone en todos sus
        servicios), se usan las redes privadas y la CGNAT: ahí el backend solo
        es alcanzable a través del proxy de Railway, así que el peer directo
        siempre es él. Fuera de Railway no se asume nada.
        """
        import ipaddress
        import os

        crudo = self.PROXIES_CONFIABLES.strip()
        if not crudo:
            if not os.getenv("RAILWAY_ENVIRONMENT_NAME"):
                return ()
            crudo = "100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

        redes = []
        for parte in crudo.split(","):
            parte = parte.strip()
            if not parte:
                continue
            try:
                redes.append(ipaddress.ip_network(parte, strict=False))
            except ValueError:
                # Una entrada mal escrita no puede tumbar el arranque ni, peor,
                # hacer que se confíe en algo que no se quiso: se ignora.
                continue
        return tuple(redes)

    @property
    def es_produccion(self) -> bool:
        return self.ENVIRONMENT == "production"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
