/**
 * hooks/useGeolocalizacionTecnico.js
 * SCRUM-163 — Obtiene y sigue la ubicación en vivo del técnico usando la
 * Geolocation API del navegador, para mostrarla como un marcador propio
 * sobre el mapa de la ruta (MapaPage + MarcadorMiUbicacion).
 *
 * SCRUM-219 — Además reporta esa posición al backend (POST /ubicaciones)
 * como máximo una vez por minuto mientras el técnico tenga jornada abierta.
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
 *   const { posicion, estado, mensaje, errorEnvio } =
 *     useGeolocalizacionTecnico({ jornadaActiva })
 *   // posicion: { lat, lng, accuracy } | null
 *
 * El parámetro es opcional: sin él el hook se comporta igual que antes de
 * SCRUM-219 (solo pinta el marcador, no reporta nada).
 */
import { useEffect, useRef, useState } from 'react'
import { enviarUbicacion } from '../api/ubicacionService'

const OPCIONES_GEOLOCALIZACION = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 15000,
}

/**
 * Tiempo mínimo entre dos escrituras en el backend.
 *
 * watchPosition dispara una lectura cada pocos segundos mientras el técnico
 * camina o va en el carro. Mandarlas todas llenaría la tabla de ubicaciones
 * con cientos de puntos por jornada y convertiría a cada teléfono en una
 * fuente de tráfico constante contra el backend; con veinte técnicos en la
 * calle eso es un ataque de denegación de servicio hecho por la propia
 * aplicación. Un punto por minuto basta de sobra para seguir una ruta.
 */
const INTERVALO_ENVIO_MS = 60 * 1000

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

export default function useGeolocalizacionTecnico({ jornadaActiva = false } = {}) {
  const [posicion, setPosicion] = useState(null)
  const [estado, setEstado] = useState('cargando')
  const [mensaje, setMensaje] = useState(null)
  const [errorEnvio, setErrorEnvio] = useState(null)

  // La jornada se guarda en una referencia en lugar de ponerla como
  // dependencia del efecto: si fuera dependencia, marcar entrada o salida
  // cortaría el watchPosition y abriría uno nuevo, y el marcador del técnico
  // desaparecería del mapa hasta la siguiente lectura del GPS.
  const jornadaActivaRef = useRef(jornadaActiva)
  useEffect(() => {
    jornadaActivaRef.current = jornadaActiva
  }, [jornadaActiva])

  // Momento del último envío. Vive en una referencia y no en el estado porque
  // cambiarlo no debe repintar nada, y porque el valor tiene que sobrevivir
  // entre lecturas del GPS sin reiniciar el efecto.
  const ultimoEnvioRef = useRef(0)

  // El envío es asíncrono y puede resolverse después de que el técnico cambió
  // de pantalla; sin esta marca se intentaría actualizar el estado de un hook
  // ya desmontado.
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true

    // Sin soporte (navegadores viejos, algunos WebViews, contexto no
    // seguro sin HTTPS): se avisa una sola vez y no se intenta nada más.
    if (!('geolocation' in navigator)) {
      setEstado('no_soportado')
      setMensaje('Este dispositivo o navegador no soporta geolocalización.')
      return
    }

    /**
     * Reporta la posición al backend si toca (SCRUM-219).
     *
     * Se dispara desde la propia lectura del GPS y no desde un setInterval
     * aparte: con dos relojes independientes el temporizador terminaría
     * mandando la última posición conocida aunque el GPS llevara rato sin
     * responder, y habría que sincronizarlos a mano.
     */
    const reportarUbicacion = (lat, lng) => {
      // Fuera de jornada el backend responde 409, así que ni se intenta: la
      // petición sería trabajo tirado para el servidor. Y si el técnico marca
      // salida desde otra pestaña, el 409 que sí llegue lo avisa abajo.
      if (!jornadaActivaRef.current) return

      const ahora = Date.now()
      if (ahora - ultimoEnvioRef.current < INTERVALO_ENVIO_MS) return

      // El sello se pone ANTES de esperar la respuesta, a propósito: si se
      // pusiera al resolverse, todas las lecturas que llegan mientras la
      // petición viaja pasarían el filtro y saldría una ráfaga de escrituras,
      // que es justo lo que este control evita.
      ultimoEnvioRef.current = ahora

      enviarUbicacion({ lat, lng })
        .then((resultado) => {
          if (!montadoRef.current) return
          setErrorEnvio(
            resultado?.ok === false
              ? 'Tu jornada no está abierta, así que tu ubicación no se está registrando.'
              : null
          )
        })
        .catch(() => {
          // El marcador no depende de esto. Un fallo de red o del backend se
          // anota y se vuelve a intentar en la siguiente lectura pasado el
          // minuto; el técnico nunca se queda sin verse en el mapa por no
          // haber podido reportar su posición.
          if (montadoRef.current) {
            setErrorEnvio('No se pudo reportar tu ubicación. Se reintentará en un minuto.')
          }
        })
    }

    const handleSuccess = (pos) => {
      setPosicion({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
      setEstado('ok')
      setMensaje(null)

      // Solo lat y lng: la precisión sirve para dibujar el círculo en el mapa,
      // pero la tabla del backend guarda un punto y nada más.
      reportarUbicacion(pos.coords.latitude, pos.coords.longitude)
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

    return () => {
      montadoRef.current = false
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  return { posicion, estado, mensaje, errorEnvio }
}
