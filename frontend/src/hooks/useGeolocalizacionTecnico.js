/**
 * hooks/useGeolocalizacionTecnico.js
 * SCRUM-163 — Obtiene y sigue la ubicación en vivo del técnico usando la
 * Geolocation API del navegador, para mostrarla como un marcador propio
 * sobre el mapa de la ruta (MapaPage + MarcadorMiUbicacion).
 *
 * SCRUM-219 — Además reporta esa posición al backend (POST /ubicaciones)
 * mientras el técnico tenga jornada abierta.
 *
 * HU-5 — Cuándo se reporta lo deciden las reglas del recorrido
 * (utils/reglasUbicacion.js): cada 2 min si se mueve, un punto de control
 * cada 5 min si está quieto, y nunca lecturas imprecisas. Sin conexión, el
 * punto se guarda en la cola (utils/colaUbicaciones.js) con su hora real y se
 * envía en lote al reconectar.
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
 *     useGeolocalizacionTecnico({ jornadaActiva, idEmpleado })
 *   // posicion: { lat, lng, accuracy } | null
 *
 * El parámetro es opcional: sin él el hook se comporta igual que antes de
 * SCRUM-219 (solo pinta el marcador, no reporta nada).
 */
import { useEffect, useRef, useState } from 'react'
import { enviarUbicacion } from '../api/ubicacionService'
import { debeReportar } from '../utils/reglasUbicacion'
import { encolarPunto, enviarCola } from '../utils/colaUbicaciones'

const OPCIONES_GEOLOCALIZACION = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 15000,
}

/*
 * watchPosition dispara una lectura cada pocos segundos mientras el técnico
 * camina o va en el carro. Mandarlas todas llenaría la tabla de ubicaciones
 * con cientos de puntos por jornada y convertiría a cada teléfono en una
 * fuente de tráfico constante contra el backend; con veinte técnicos en la
 * calle eso es un ataque de denegación de servicio hecho por la propia
 * aplicación. La frecuencia la fija debeReportar (utils/reglasUbicacion.js).
 */

const AVISO_SIN_CONEXION =
  'Sin conexión: tu ubicación se guarda en el teléfono y se enviará al reconectar.'

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

export default function useGeolocalizacionTecnico({
  jornadaActiva = false,
  idEmpleado = null,
} = {}) {
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

  // Mismo motivo: el efecto del GPS no se reinicia al cambiar de usuario.
  const idEmpleadoRef = useRef(idEmpleado)
  useEffect(() => {
    idEmpleadoRef.current = idEmpleado
  }, [idEmpleado])

  // Último punto reportado {lat, lng, t}. Vive en una referencia y no en el
  // estado porque cambiarlo no debe repintar nada, y porque el valor tiene
  // que sobrevivir entre lecturas del GPS sin reiniciar el efecto.
  const ultimoEnvioRef = useRef(null)

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
    const reportarUbicacion = (lat, lng, accuracy, timestamp) => {
      // Fuera de jornada el backend responde 409, así que ni se intenta: la
      // petición sería trabajo tirado para el servidor. Y si el técnico marca
      // salida desde otra pestaña, el 409 que sí llegue lo avisa abajo.
      if (!jornadaActivaRef.current) return

      const ahora = Date.now()
      if (!debeReportar(ultimoEnvioRef.current, { lat, lng, accuracy }, ahora)) return

      // El sello se pone ANTES de esperar la respuesta, a propósito: si se
      // pusiera al resolverse, todas las lecturas que llegan mientras la
      // petición viaja pasarían el filtro y saldría una ráfaga de escrituras,
      // que es justo lo que este control evita.
      ultimoEnvioRef.current = { lat, lng, t: ahora }

      // HU-5: hora real de la lectura, por si el punto termina en la cola.
      const punto = {
        lat,
        lng,
        fecha_hora: new Date(Number.isFinite(timestamp) ? timestamp : ahora).toISOString(),
      }

      // Sin red no tiene sentido esperar a que falle la petición.
      if (navigator.onLine === false) {
        encolarPunto(idEmpleadoRef.current, punto)
        setErrorEnvio(AVISO_SIN_CONEXION)
        return
      }

      enviarUbicacion({ lat, lng })
        .then((resultado) => {
          if (!montadoRef.current) return
          setErrorEnvio(
            resultado?.ok === false
              ? 'Tu jornada no está abierta, así que tu ubicación no se está registrando.'
              : null
          )
          // Hay conexión: se aprovecha para vaciar lo que quedó pendiente.
          if (resultado?.ok !== false) enviarCola(idEmpleadoRef.current)
        })
        .catch((err) => {
          // El marcador no depende de esto; el técnico nunca se queda sin
          // verse en el mapa por no haber podido reportar su posición.
          // Sin respuesta del servidor es falta de red: el punto va a la cola
          // en vez de perderse. Con respuesta es un fallo del backend: se
          // avisa y se reintenta con la siguiente lectura que toque.
          if (!err?.response) encolarPunto(idEmpleadoRef.current, punto)
          if (montadoRef.current) {
            setErrorEnvio(
              err?.response
                ? 'No se pudo reportar tu ubicación. Se reintentará en unos minutos.'
                : AVISO_SIN_CONEXION
            )
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

      // La precisión no se guarda en el backend (la tabla guarda un punto),
      // pero sí decide si la lectura es confiable para el recorrido.
      reportarUbicacion(
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.accuracy,
        pos.timestamp,
      )
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

  // HU-5: al volver la señal (y al abrir la app) se envía lo que quedó en la
  // cola. `online` lo dispara el navegador al recuperar la red.
  useEffect(() => {
    const vaciarCola = () => {
      enviarCola(idEmpleadoRef.current).then((enviados) => {
        if (enviados > 0 && montadoRef.current) setErrorEnvio(null)
      })
    }
    vaciarCola()
    window.addEventListener('online', vaciarCola)
    return () => window.removeEventListener('online', vaciarCola)
  }, [idEmpleado])

  return { posicion, estado, mensaje, errorEnvio }
}
