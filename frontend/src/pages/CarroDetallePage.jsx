/**
 * Vista de detalle de un vehículo mostrando sus herramientas asignadas.
 * Incluye botón para abrir el modal de asignación y opción de liberar.
 *
 * Ruta sugerida: /supervisor/carros/:id
 *
 *  Los endpoints de backend pues igual  están comentados
 *
 * Cuando se  termine el backend:
 *   2. Los comentarios en carroService.js indican qué descomentar en cada caso
 * ---------------------------------------------------------------------------
 */

import { useCallback, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Modal, { ModalActions } from '../components/ui/Modal'
import PageState from '../components/ui/PageState'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import ModalAsignarHerramientas from '../components/carros/ModalAsignarHerramientas'
import styles from './CarroDetallePage.module.css'

import {
  getCarroById,
  getHerramientasDeCarro,
  asignarHerramientaACarro,
  liberarHerramientaDeCarro,
} from '../api/carroService'

/*  Iconos  */
const IconBack = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="19" y1="12" x2="5" y2="12"/>
    <polyline points="12 19 5 12 12 5"/>
  </svg>
)
const IconCar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-1"/>
    <circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
  </svg>
)
const IconWrench = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)
const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)
const IconTag = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>
)
const IconInfo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
)

/*Helpers */
const formatFecha = (isoString) => {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString('es-GT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

/*  Sub-componente: modal de confirmación liberar*/
function ModalConfirmarLiberar({ herramienta, onConfirmar, onCancelar, cargando }) {
  // Usa el Modal compartido en vez de un overlay propio, para que el diálogo
  // de confirmación se vea igual que el resto de modales de la app.
  return (
    <Modal
      open={Boolean(herramienta)}
      onClose={onCancelar}
      title="Liberar herramienta"
      width={420}
    >
      <div className={styles.confirmIconWrap}>
        <IconTrash />
      </div>
      <p className={styles.confirmDesc}>
        ¿Deseas retirar <strong>{herramienta?.nombre_activo}</strong> de este vehículo?
        La herramienta quedará disponible para reasignar.
      </p>
      <ModalActions>
        <button className={styles.confirmCancelBtn} onClick={onCancelar} disabled={cargando}>
          Cancelar
        </button>
        <button
          className={styles.confirmDeleteBtn}
          onClick={() => onConfirmar(herramienta.id_activo)}
          disabled={cargando}
        >
          {cargando
            ? <><Spinner size="sm" color="white" /> Liberando...</>
            : <><IconTrash /> Liberar</>}
        </button>
      </ModalActions>
    </Modal>
  )
}

/* 
   COMPONENTE PRINCIPAL
    */
export default function CarroDetallePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [carro,            setCarro]            = useState(null)
  const [herramientas,     setHerramientas]     = useState([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState(null)

  const [modalAsignar,     setModalAsignar]     = useState(false)
  const [herramientaLiberar, setHerramientaLiberar] = useState(null)
  const [liberando,        setLiberando]        = useState(false)

  /* Fetch inicial  */
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [carroData, herrData] = await Promise.all([
        getCarroById(id),
        getHerramientasDeCarro(id),
      ])
      setCarro(carroData)
      setHerramientas(herrData)
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'No se pudo cargar el vehículo.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  /*  Asignar herramientas (desde modal)  */
  const handleAsignar = async (idsSeleccionados) => {
    // Si falla, el error sube al modal, que lo captura y muestra internamente
    await Promise.all(
      idsSeleccionados.map((idH) => asignarHerramientaACarro(id, idH))
    )
    const herrActualizadas = await getHerramientasDeCarro(id)
    setHerramientas(herrActualizadas)
    setModalAsignar(false)
    toast.success(
      `${idsSeleccionados.length} herramienta${idsSeleccionados.length !== 1 ? 's asignadas' : ' asignada'} correctamente.`
    )
  }

  /*  Liberar herramienta  */
  const handleLiberar = async (idHerramienta) => {
    setLiberando(true)
    try {
      await liberarHerramientaDeCarro(id, idHerramienta)
      setHerramientas((prev) => prev.filter((h) => h.id_activo !== idHerramienta))
      setHerramientaLiberar(null)
      toast.success('Herramienta liberada y disponible para reasignación.')
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'No se pudo liberar la herramienta.')
      setHerramientaLiberar(null)
    } finally {
      setLiberando(false)
    }
  }

  /*  IDs ya asignados (para excluir del modal)  */
  const idsAsignados = herramientas.map((h) => h.id_activo)

  /*  Estados visuales del vehículo  */
  const estadoConfig = {
    disponible:  { label: 'Disponible',  cls: styles.estadoDisponible },
    en_uso:      { label: 'En uso',      cls: styles.estadoEnUso },
    mantenimiento:{ label: 'Mantenimiento', cls: styles.estadoMantenimiento },
  }
  const estadoActual = estadoConfig[carro?.estado_vehiculo] ?? estadoConfig.disponible

  /*  Render  */
  const estadoPagina = (
    <PageState
      loading={loading}
      loadingLabel="Cargando vehículo..."
      error={error}
      onRetry={fetchData}
      errorTitle="No se pudo cargar el vehículo"
    />
  )
  if (estadoPagina) return estadoPagina

  return (
    <div className={styles.page}>

      {/* El feedback de éxito/error sale por el toast global. */}

      {/*  Botón volver  */}
      <button className={styles.backBtn} onClick={() => navigate(-1)}>
        <IconBack /> Volver
      </button>

      {/* 
          SECCIÓN 1: Ficha del vehículo
           */}
      <section className={styles.fichaCard}>
        <div className={styles.fichaHeader}>
          <div className={styles.fichaIconWrap}>
            <IconCar />
          </div>
          <div className={styles.fichaHeaderInfo}>
            <div className={styles.fichaTitleRow}>
              <h1 className={styles.fichaTitle}>{carro.nombre_activo}</h1>
              <span className={`${styles.estadoBadge} ${estadoActual.cls}`}>
                <span className={styles.estadoDot} />
                {estadoActual.label}
              </span>
            </div>
            <p className={styles.fichaPlaca}>{carro.placa}</p>
          </div>
        </div>

        <div className={styles.fichaGrid}>
          <div className={styles.fichaItem}>
            <span className={styles.fichaItemLabel}>Marca</span>
            <span className={styles.fichaItemValue}>{carro.marca ?? '—'}</span>
          </div>
          <div className={styles.fichaItem}>
            <span className={styles.fichaItemLabel}>Modelo</span>
            <span className={styles.fichaItemValue}>{carro.modelo ?? '—'}</span>
          </div>
          <div className={styles.fichaItem}>
            <span className={styles.fichaItemLabel}>Capacidad</span>
            <span className={styles.fichaItemValue}>
              {carro.capacidad ? `${carro.capacidad} personas` : '—'}
            </span>
          </div>
          <div className={styles.fichaItem}>
            <span className={styles.fichaItemLabel}>Herramientas</span>
            <span className={styles.fichaItemValue}>{herramientas.length} asignadas</span>
          </div>
        </div>

        {carro.descripcion && (
          <p className={styles.fichaDesc}>{carro.descripcion}</p>
        )}
      </section>

      {/* 
          SECCIÓN 2: Herramientas asignadas
           */}
      <section className={styles.herramientasSection}>
        <div className={styles.herramientasHeader}>
          <div className={styles.herramientasTitleWrap}>
            <span className={styles.herramientasTitleIcon}><IconWrench /></span>
            <div>
              <h2 className={styles.herramientasTitle}>Herramientas asignadas</h2>
              <p className={styles.herramientasSubtitle}>
                {herramientas.length === 0
                  ? 'Ninguna herramienta asignada a este vehículo.'
                  : `${herramientas.length} herramienta${herramientas.length !== 1 ? 's' : ''} en este vehículo`}
              </p>
            </div>
          </div>

          <button
            className={styles.asignarBtn}
            onClick={() => setModalAsignar(true)}
          >
            <IconPlus />
            <span>Asignar herramientas</span>
          </button>
        </div>

        {/* Lista de herramientas */}
        {herramientas.length === 0 ? (
          <div className={styles.emptyHerramientas}>
            <div className={styles.emptyHerramientasIcon}><IconWrench /></div>
            <p className={styles.emptyHerramientasMsg}>
              Este vehículo no tiene herramientas asignadas.
            </p>
            <button
              className={styles.emptyAsignarBtn}
              onClick={() => setModalAsignar(true)}
            >
              <IconPlus /> Asignar primera herramienta
            </button>
          </div>
        ) : (
          <ul className={styles.herramientasList}>
            {herramientas.map((herr) => (
              <li key={herr.id_activo} className={styles.herramientaItem}>

                {/* Ícono */}
                <div className={styles.herramientaIconWrap}>
                  <IconWrench />
                </div>

                {/* Info principal */}
                <div className={styles.herramientaInfo}>
                  <span className={styles.herramientaNombre}>{herr.nombre_activo}</span>
                  <div className={styles.herramientaMeta}>
                    {herr.tipo_herramienta && (
                      <span className={styles.metaTag}>
                        <IconTag /> {herr.tipo_herramienta}
                      </span>
                    )}
                    {(herr.marca || herr.modelo) && (
                      <span className={styles.metaTag}>
                        {[herr.marca, herr.modelo].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {herr.fecha_asignacion && (
                      <span className={styles.metaTag}>
                        <IconCalendar /> Asignada el {formatFecha(herr.fecha_asignacion)}
                      </span>
                    )}
                  </div>
                  {herr.comentario && (
                    <p className={styles.herramientaComentario}>
                      <IconInfo /> {herr.comentario}
                    </p>
                  )}
                </div>

                {/* Estado + acción */}
                <div className={styles.herramientaAcciones}>
                  <span className={`${styles.herramientaEstado} ${
                    herr.estado === 'disponible'
                      ? styles.estadoHDisponible
                      : styles.estadoHEnUso
                  }`}>
                    {herr.estado}
                  </span>

                  <button
                    className={styles.liberarBtn}
                    onClick={() => setHerramientaLiberar(herr)}
                    title={`Liberar ${herr.nombre_activo}`}
                  >
                    <IconTrash />
                    <span>Liberar</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*  Modal asignar herramientas  */}
      {modalAsignar && (
        <ModalAsignarHerramientas
          carro={carro}
          herramientasYa={idsAsignados}
          onAsignar={handleAsignar}
          onCerrar={() => setModalAsignar(false)}
        />
      )}

      {/*  Modal confirmar liberar  */}
      {herramientaLiberar && (
        <ModalConfirmarLiberar
          herramienta={herramientaLiberar}
          onConfirmar={handleLiberar}
          onCancelar={() => setHerramientaLiberar(null)}
          cargando={liberando}
        />
      )}
    </div>
  )
}