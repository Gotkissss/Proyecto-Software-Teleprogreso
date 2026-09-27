
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getEstadoPausas } from '../api/asistenciaService'
import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'

const UbicacionContext = createContext(null)


const INTERVALO_REFRESCO_JORNADA_MS = 30 * 1000

/**
 * @param {Object} props
 * @param {number} [props.idEmpleado] - técnico autenticado. Lo usa la cola de
 *   puntos sin conexión (HU-5) para no mezclar los de dos usuarios del mismo
 *   teléfono; sin él, los puntos sin red simplemente no se encolan.
 */
export function UbicacionProvider({ children, idEmpleado = null }) {
  const [jornadaActiva, setJornadaActiva] = useState(false)
  // HU-5: false hasta la primera respuesta. Evita que la ruta muestre por un
  // instante "registra tu entrada" a quien ya tiene la jornada abierta.
  const [jornadaCargada, setJornadaCargada] = useState(false)
  const montadoRef = useRef(true)

  const consultarJornada = useCallback(async () => {
    try {
      const estadoPausas = await getEstadoPausas()
      if (montadoRef.current) setJornadaActiva(Boolean(estadoPausas.jornada_activa))
    } catch {
      // Sin dato confiable de jornada se asume cerrada: es la opción
      // segura. Dejar de reportar por un fallo de red pasajero se corrige
      // solo en el siguiente ciclo; reportar de más cuando en realidad no
      // hay jornada abierta no tiene forma de corregirse después.
      if (montadoRef.current) setJornadaActiva(false)
    } finally {
      if (montadoRef.current) setJornadaCargada(true)
    }
  }, [])

  useEffect(() => {
    montadoRef.current = true

    consultarJornada()
    const intervalo = setInterval(consultarJornada, INTERVALO_REFRESCO_JORNADA_MS)

    return () => {
      montadoRef.current = false
      clearInterval(intervalo)
    }
  }, [consultarJornada])

  // SCRUM-163/219: ubicación en vivo + reporte periódico al backend. Vive
  // aquí y no en cada pantalla que lo necesite (ver comentario de arriba).
  const { posicion, estado, mensaje, errorEnvio } =
    useGeolocalizacionTecnico({ jornadaActiva, idEmpleado })

  const compartiendo = jornadaActiva && estado === 'ok'

  const value = {
    jornadaActiva,
    jornadaCargada,
    posicion,
    estado,
    mensaje,
    errorEnvio,
    compartiendo,
    // HU-5: las pantallas que cambian la jornada (marcar entrada o salida) o
    // que dependen de ella (bloqueo de tareas) la refrescan al momento en vez
    // de esperar el siguiente ciclo de 30 s.
    refrescarJornada: consultarJornada,
  }

  return (
    <UbicacionContext.Provider value={value}>
      {children}
    </UbicacionContext.Provider>
  )
}

export function useUbicacion() {
  const ctx = useContext(UbicacionContext)
  if (!ctx) throw new Error('useUbicacion debe usarse dentro de <UbicacionProvider>')
  return ctx
}