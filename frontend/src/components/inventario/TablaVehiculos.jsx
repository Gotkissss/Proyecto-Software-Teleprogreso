import { Link } from 'react-router-dom'
import { urlArchivo } from '../../api/client'
import Badge from '../ui/Badge'
import { VehiculoMiniatura } from './MiniaturaActivo'
import { IconEdit, IconTrash } from './InventarioIcons'
import TablaFiltrable from './TablaFiltrable'
import styles from './TablaVehiculos.module.css'

const ESTADO_VEHICULO_LABEL = {
  disponible:     'Disponible',
  en_uso:         'En uso',
  mantenimiento:  'Mantenimiento',
  fuera_servicio: 'Fuera de servicio',
}

const ESTADO_VEHICULO_VARIANT = {
  disponible:     'success',
  en_uso:         'info',
  mantenimiento:  'warning',
  fuera_servicio: 'danger',
}

const IconWrench = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)

const IconCar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5L8 4h8l1.5 3H19a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2M5 17a2 2 0 1 0 4 0m6 0a2 2 0 1 0 4 0"/>
  </svg>
)

export default function TablaVehiculos({
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  onAsignarTecnico,
  onEditar,
  onEliminar,
}) {
  const columns = [
    {
      key: 'nombre_activo',
      label: 'Vehículo',
      render: v => (
        <div className={styles.activoCell}>
          <VehiculoMiniatura marca={v.marca} fotoUrl={urlArchivo(v.foto_url)} color="#1e3a5f" />
          {/* El nombre lleva a la ficha del vehículo. Antes esa pantalla
              existía pero no se enlazaba desde ningún sitio: solo se llegaba
              escribiendo /supervisor/carros/{id} a mano. */}
          <Link
            to={`/supervisor/carros/${v.id_activo}`}
            className={styles.activoNombreLink}
            title="Ver herramientas de este vehículo"
          >
            {v.nombre_activo}
          </Link>
        </div>
      ),
    },
    {
      key: 'placa',
      label: 'Placa',
      sortable: true,
      render: v => <span className={styles.placaBadge}>{v.placa}</span>,
    },
    {
      key: 'marca',
      label: 'Marca / Modelo',
      sortable: true,
      render: v => (
        <span className={styles.textoSecundario}>
          {[v.marca, v.modelo].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'estado_vehiculo',
      label: 'Estado',
      sortable: true,
      render: v => (
        <Badge
          label={ESTADO_VEHICULO_LABEL[v.estado_vehiculo] ?? v.estado_vehiculo}
          variant={ESTADO_VEHICULO_VARIANT[v.estado_vehiculo] ?? 'muted'}
        />
      ),
    },
    {
      key: 'nombre_empleado_asignado',
      label: 'Técnico asignado',
      render: v => (
        <span className={styles.textoSecundario}>
          {v.nombre_empleado_asignado || 'Sin asignar'}
        </span>
      ),
    },
    {
      key: 'acciones',
      label: 'Acciones',
      align: 'right',
      render: v => (
        <div className={styles.actionBtns}>
          <Link
            to={`/supervisor/carros/${v.id_activo}`}
            className="btn btn-secondary btn-sm"
            title="Ver herramientas de este vehículo"
          >
            <IconWrench /> Herramientas
          </Link>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAsignarTecnico(v)}>
            Asignar técnico
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditar(v)} title="Editar vehículo">
            <IconEdit />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEliminar(v)} title="Eliminar vehículo">
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
      rowKey={v => v.id_activo}
      loadingLabel="Cargando vehículos..."
      emptyIcon={<IconCar />}
      emptyTitle="Sin vehículos"
      emptyDescription="No se encontraron vehículos con esos criterios de búsqueda."
      footerLabel={n => `Mostrando ${n} vehículo${n !== 1 ? 's' : ''}`}
    />
  )
}
