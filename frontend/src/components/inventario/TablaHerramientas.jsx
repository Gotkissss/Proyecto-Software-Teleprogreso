import Badge from '../ui/Badge'
import { HerramientaMiniatura } from './MiniaturaActivo'
import { IconEdit, IconTrash } from './InventarioIcons'
import TablaFiltrable from './TablaFiltrable'
import styles from './TablaHerramientas.module.css'

const ESTADO_HERR_LABEL = {
  disponible:    'Disponible',
  en_uso:        'En uso',
  mantenimiento: 'Mantenimiento',
  dañada:        'Dañada',
}

const ESTADO_HERR_VARIANT = {
  disponible:    'success',
  en_uso:        'info',
  mantenimiento: 'warning',
  dañada:        'danger',
}

const IconTool = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)

function fotoUrl(path) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `http://localhost:8000${path}`
}

export default function TablaHerramientas({
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  onAsignarCarro,
  onEditar,
  onEliminar,
}) {
  const columns = [
    {
      key: 'nombre_activo',
      label: 'Herramienta',
      render: h => (
        <div className={styles.activoCell}>
          <HerramientaMiniatura tipo={h.tipo_herramienta} foto={fotoUrl(h.foto_url)} />
          <span className={styles.activoNombre}>{h.nombre_activo}</span>
        </div>
      ),
    },
    {
      key: 'tipo_herramienta',
      label: 'Tipo',
      sortable: true,
      render: h => <span className={styles.tipoTag}>{h.tipo_herramienta || '—'}</span>,
    },
    {
      key: 'marca',
      label: 'Marca / Modelo',
      sortable: true,
      render: h => (
        <span className={styles.textoSecundario}>
          {[h.marca, h.modelo].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'estado',
      label: 'Estado',
      sortable: true,
      render: h => (
        <Badge
          label={ESTADO_HERR_LABEL[h.estado] ?? h.estado}
          variant={ESTADO_HERR_VARIANT[h.estado] ?? 'muted'}
        />
      ),
    },
    {
      key: 'acciones',
      label: 'Acciones',
      align: 'right',
      render: h => (
        <div className={styles.actionBtns}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAsignarCarro(h)}>
            Asignar a vehículo
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditar(h)} title="Editar herramienta">
            <IconEdit />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEliminar(h)} title="Eliminar herramienta">
            <IconTrash />
          </button>
        </div>
      ),
    },
  ]

  return (
    <TablaFiltrable
      columns={columns}
      datos={datos}
      loading={loading}
      sortConfig={sortConfig}
      onSort={onSort}
      rowKey={h => h.id_activo}
      loadingLabel="Cargando herramientas..."
      emptyIcon={<IconTool />}
      emptyTitle="Sin herramientas"
      emptyDescription="No se encontraron herramientas con esos criterios de búsqueda."
      footerLabel={n => `Mostrando ${n} herramienta${n !== 1 ? 's' : ''}`}
    />
  )
}
