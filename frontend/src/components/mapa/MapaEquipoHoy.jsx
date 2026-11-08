/**
 * components/mapa/MapaEquipoHoy.jsx
 * ---------------------------------------------------------------------------
 * El mapa del panel: dónde está hoy cada técnico, a la mano, nada más.
 *
 * No filtra, no deja elegir fecha y no dibuja recorridos ni tareas. Eso ya
 * existe y vive en la pantalla de Mapa, que es a donde se va quien necesita
 * seguir a alguien. Aquí la pregunta es otra y se responde al entrar: «¿dónde
 * anda la gente?». Un filtro de más convierte un vistazo en una consulta.
 *
 * Es una pieza tonta: recibe los puntos ya pedidos por el panel, así que el
 * botón «Actualizar» de arriba también refresca el mapa y la hora que dice
 * «Actualizado hace un momento» vale igual para los dos.
 *
 * Quien no tiene jornada abierta sale en gris y con la etiqueta «Fuera de
 * jornada», ya sea porque cerró al mediodía o porque hoy no marcó entrada. No
 * es decoración: su punto puede ser de hace horas, y pintarlo igual que los
 * demás diría que sigue ahí.
 * ---------------------------------------------------------------------------
 */
import AjustarVistaMarcadores from './AjustarVistaMarcadores'
import MapaBase from './MapaBase'
import MarcadorTecnico from './MarcadorTecnico'
import EmptyState from '../ui/EmptyState'
import { ESTADO_TECNICO_COLOR, ESTADO_TECNICO_LABEL } from './estadoColor'
import styles from './MapaEquipoHoy.module.css'

/** Orden de la leyenda: primero quien está trabajando, al final quien ya no. */
const ORDEN_ESTADOS = ['en_tarea', 'disponible', 'en_pausa', 'fuera_de_jornada']

const IconPin = () => (
  <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

export default function MapaEquipoHoy({ puntos = [], error = false }) {
  // Un punto sin coordenadas no se puede pintar, y colarlo en el conteo haría
  // que la cuenta de la cabecera no cuadre con los marcadores del mapa.
  const visibles = puntos.filter((p) => p?.lat != null && p?.lng != null)
  const enLaCalle = visibles.filter((p) => p.estado !== 'fuera_de_jornada')

  const porEstado = ORDEN_ESTADOS.map((estado) => ({
    estado,
    n: visibles.filter((p) => p.estado === estado).length,
  })).filter((fila) => fila.n > 0)

  return (
    <div className={styles.wrap}>
      <header className={styles.cabecera}>
        <h2 className={styles.titulo}>Dónde está el equipo</h2>
        {visibles.length > 0 && (
          <span className={styles.conteo}>
            <strong>{enLaCalle.length}</strong> en la calle
          </span>
        )}
      </header>

      {error ? (
        <p className={styles.aviso}>
          No se pudieron cargar las ubicaciones. Usa «Actualizar» para volver a
          pedirlas.
        </p>
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={<IconPin />}
          title="Nadie ha reportado su ubicación hoy"
          description="Los técnicos aparecen aquí en cuanto marcan entrada y la aplicación envía su posición."
        />
      ) : (
        <>
          <div className={styles.mapa}>
            <MapaBase scrollWheelZoom={false}>
              <AjustarVistaMarcadores
                puntos={visibles.map((p) => [p.lat, p.lng])}
                padding={36}
              />
              {visibles.map((p) => (
                <MarcadorTecnico key={p.id_empleado} tecnico={p} />
              ))}
            </MapaBase>
          </div>

          <ul className={styles.leyenda}>
            {porEstado.map(({ estado, n }) => (
              <li key={estado} className={styles.leyendaItem}>
                <span
                  className={styles.punto}
                  style={{ background: ESTADO_TECNICO_COLOR[estado] }}
                  aria-hidden="true"
                />
                {n} {ESTADO_TECNICO_LABEL[estado]?.toLowerCase() ?? estado}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
