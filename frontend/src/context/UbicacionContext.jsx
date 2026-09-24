
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { getEstadoPausas } from '../api/asistenciaService'
import useGeolocalizacionTecnico from '../hooks/useGeolocalizacionTecnico'

const UbicacionContext = createContext(null)


const INTERVALO_REFRESCO_JORNADA_MS = 30 * 1000

export function UbicacionProvider({ children }) {
  const [jornadaActiva, setJornadaActiva] = useState(false)
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true

    const consultarJornada = async () => {
      try {
        const estadoPausas = await getEstadoPausas()
        if (montadoRef.current) setJornadaActiva(Boolean(estadoPausas.jornada_activa))
      } catch {
        // Sin dato confiable de jornada se asume cerrada: es la opción
        // segura. Dejar de reportar por un fallo de red pasajero se corrige
        // solo en el siguiente ciclo; reportar de más cuando en realidad no
        // hay jornada abierta no tiene forma de corregirse después.
        if (montadoRef.current) setJornadaActiva(false)
      }
    }

    consultarJornada()
    const intervalo = setInterval(consultarJornada, INTERVALO_REFRESCO_JORNADA_MS)

    return () => {
      montadoRef.current = false
      clearInterval(intervalo)
    }
  }, [])

  // SCRUM-163/219: ubicación en vivo + reporte periódico al backend. Vive
  // aquí y no en cada pantalla que lo necesite (ver comentario de arriba).
  const { posicion, estado, mensaje, errorEnvio } =
    useGeolocalizacionTecnico({ jornadaActiva })

  const compartiendo = jornadaActiva && estado === 'ok'

  const value = {
    jornadaActiva,
    posicion,
    estado,
    mensaje,
    errorEnvio,
    compartiendo,
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