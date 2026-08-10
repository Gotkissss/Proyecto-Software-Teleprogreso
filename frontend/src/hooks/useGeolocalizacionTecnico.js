/**
 * hooks/useGeolocalizacionTecnico.js
 * SCRUM-163 — Obtiene y sigue la ubicación en vivo del técnico usando la
 * Geolocation API del navegador, para mostrarla como un marcador propio
 * sobre el mapa de la ruta (MapaPage + MarcadorMiUbicacion).
 *
 * Es un hook independiente: no toca la carga de tareas/servicios que ya
 * existe en MapaPage (SCRUM-162), solo expone la posición del dispositivo
 * y un estado explícito para los casos que la pantalla debe manejar
 * distinto:
 *   - 'cargando'      -> esperando la primera lectura de ubicación
 *   - 'ok'             -> hay coordenadas válidas en `posicion`
 *   - 'no_soportado'   -> el navegador no expone la Geolocation API
 *   - 'denegado'       -> el usuario rechazó (o tiene bloqueado) el permiso
 *   - 'error'          -> hay soporte y permiso, pero no se pudo leer la
 *                         posición (GPS apagado, sin señal, timeout, etc.)
 *
 * Uso:
 *   const { posicion, estado, mensaje } = useGeolocalizacionTecnico()
 *   // posicion: { lat, lng, accuracy } | null
 */
import { useEffect, useState } from 'react'

const OPCIONES_GEOLOCALIZACION = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 15000,
}

function mensajePorError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Activa el permiso de ubicación en tu navegador para verte en el mapa.'
    case error.POSITION_UNAVAILABLE:
      return 'No se pudo determinar tu ubicación. Revisa el GPS o la conexión.'
    case error.TIMEOUT:
      return 'La ubicación tardó demasiado en responder. Reintentando…'
    default:
      return 'No se pudo obtener tu ubicación.'
  }
}

export default function useGeolocalizacionTecnico() {
  const [posicion, setPosicion] = useState(null)
  const [estado, setEstado] = useState('cargando')
  const [mensaje, setMensaje] = useState(null)

  useEffect(() => {
    // Sin soporte (navegadores viejos, algunos WebViews, contexto no
    // seguro sin HTTPS): se avisa una sola vez y no se intenta nada más.
    if (!('geolocation' in navigator)) {
      setEstado('no_soportado')
      setMensaje('Este dispositivo o navegador no soporta geolocalización.')
      return
    }

    const handleSuccess = (pos) => {
      setPosicion({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
      setEstado('ok')
      setMensaje(null)
    }

    const handleError = (error) => {
      setEstado(error.code === error.PERMISSION_DENIED ? 'denegado' : 'error')
      setMensaje(mensajePorError(error))
    }

    // watchPosition (no getCurrentPosition): el técnico se mueve en la
    // calle mientras hace la ruta, así que el punto en el mapa debe irse
    // actualizando solo en vez de quedarse fijo en la primera lectura.
    const watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      OPCIONES_GEOLOCALIZACION
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  return { posicion, estado, mensaje }
}