# backend/app/services/asistencia.py
"""
Calculo de horas trabajadas y tiempo en pausas por jornada.
-----------------------------------------------------------------------------
La base de datos guarda `hora_entrada`, `hora_salida`, `hora_inicio` y
`hora_fin` como columnas TIME (sin fecha). Por eso todos los calculos se hacen
sobre segundos del dia y, cuando el valor final es negativo, se asume que la
jornada cruzo la medianoche y se suman 24 h.

Las funciones de este modulo son puras (no tocan la base de datos) para poder
probarlas con unit tests sin necesidad de PostgreSQL.
-----------------------------------------------------------------------------
"""

from dataclasses import dataclass, field
from datetime import time
from typing import Iterable, List, Optional

SEGUNDOS_POR_DIA = 24 * 3600


# ── Utilidades de tiempo ─────────────────────────────────────────────────────

def _a_segundos(valor: time) -> int:
    """Convierte un `time` en segundos transcurridos desde las 00:00."""
    return valor.hour * 3600 + valor.minute * 60 + valor.second


def segundos_entre(inicio: time, fin: time) -> int:
    """
    Segundos transcurridos entre dos horas del mismo turno.

    Si `fin` es menor que `inicio` se asume que el turno cruzo la medianoche
    (turnos nocturnos) y se suman 24 h en lugar de devolver un negativo.
    """
    delta = _a_segundos(fin) - _a_segundos(inicio)
    if delta < 0:
        delta += SEGUNDOS_POR_DIA
    return delta


def formatear_hhmm(minutos: int) -> str:
    """Convierte minutos a la cadena 'HH:MM' que muestra la UI."""
    minutos = max(0, int(minutos))
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


# ── Resultado del calculo ────────────────────────────────────────────────────

@dataclass
class ResumenPausa:
    id_descanso: int
    hora_inicio: time
    hora_fin: Optional[time]
    minutos: int
    en_curso: bool


@dataclass
class ResumenJornada:
    """Metricas calculadas de una jornada."""

    minutos_brutos: int = 0
    minutos_pausa: int = 0
    minutos_trabajados: int = 0
    jornada_activa: bool = False
    pausas: List[ResumenPausa] = field(default_factory=list)

    @property
    def total_pausas(self) -> int:
        return len(self.pausas)


# ── Calculo principal ────────────────────────────────────────────────────────

def calcular_minutos_pausas(
    descansos: Iterable,
    referencia: Optional[time] = None,
) -> List[ResumenPausa]:
    """
    Calcula la duracion de cada pausa de una jornada.

    Una pausa sin `hora_fin` sigue en curso: solo se contabiliza si se pasa una
    hora de `referencia` (normalmente "ahora" para la jornada del dia actual).
    Sin referencia se contabiliza como 0 para no inventar tiempo trabajado.
    """
    resumen: List[ResumenPausa] = []

    for descanso in descansos:
        abierta = descanso.hora_fin is None
        if not abierta:
            minutos = segundos_entre(descanso.hora_inicio, descanso.hora_fin) // 60
        elif referencia is not None:
            minutos = segundos_entre(descanso.hora_inicio, referencia) // 60
        else:
            minutos = 0

        resumen.append(
            ResumenPausa(
                id_descanso=descanso.id_descanso,
                hora_inicio=descanso.hora_inicio,
                hora_fin=descanso.hora_fin,
                minutos=minutos,
                en_curso=abierta,
            )
        )

    return resumen


def calcular_jornada(
    asistencia,
    descansos: Optional[Iterable] = None,
    referencia: Optional[time] = None,
) -> ResumenJornada:
    """
    Calcula horas trabajadas y tiempo en pausas de una jornada.

    Args:
        asistencia: registro con `hora_entrada` y `hora_salida`.
        descansos:  pausas de esa jornada (si se omite se usan las de la relacion).
        referencia: hora con la que se cierran jornadas/pausas todavia abiertas.
                    Se usa para mostrar el avance del dia en curso; si es None,
                    una jornada abierta reporta 0 minutos.

    Returns:
        ResumenJornada con los minutos brutos, en pausa y efectivamente
        trabajados (nunca negativos).
    """
    if descansos is None:
        descansos = getattr(asistencia, "descansos", []) or []

    jornada_activa = asistencia.hora_salida is None

    # Hora con la que se cierra el calculo: la salida real o la referencia.
    cierre = asistencia.hora_salida or referencia

    if asistencia.hora_entrada is None or cierre is None:
        minutos_brutos = 0
    else:
        minutos_brutos = segundos_entre(asistencia.hora_entrada, cierre) // 60

    pausas = calcular_minutos_pausas(
        descansos,
        referencia=cierre if jornada_activa else asistencia.hora_salida,
    )
    minutos_pausa = sum(p.minutos for p in pausas)

    # Las pausas no pueden superar la jornada: si los datos son inconsistentes
    # (p.e. una pausa mal cerrada) se recorta en lugar de devolver negativos.
    minutos_pausa = min(minutos_pausa, minutos_brutos) if minutos_brutos else minutos_pausa
    minutos_trabajados = max(0, minutos_brutos - minutos_pausa)

    return ResumenJornada(
        minutos_brutos=minutos_brutos,
        minutos_pausa=minutos_pausa,
        minutos_trabajados=minutos_trabajados,
        jornada_activa=jornada_activa,
        pausas=pausas,
    )
