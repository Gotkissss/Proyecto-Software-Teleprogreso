from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Base de datos
    DATABASE_URL: str
    DATABASE_URL_SYNC: str

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # CORS — acepta JSON list o string separado por comas
    BACKEND_CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    @field_validator("DATABASE_URL", "DATABASE_URL_SYNC", "SECRET_KEY", "ALGORITHM", mode="before")
    @classmethod
    def strip_str(cls, v):
        # Los .env editados en Windows pueden dejar \r al final de cada
        # valor (CRLF); python-jose rechaza un SECRET_KEY con \r.
        return v.strip() if isinstance(v, str) else v

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors(cls, v):
        if isinstance(v, str):
            # Si es JSON válido, se parsea; si no, se divide por comas.
            # Robusto ante corchetes sin comillas ("[http://a,http://b]")
            # y ante \r de archivos .env editados en Windows.
            v = v.strip()
            if v.startswith("["):
                import json
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    v = v.strip("[]")
            return [origin.strip().strip('"\'') for origin in v.split(",") if origin.strip()]
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
