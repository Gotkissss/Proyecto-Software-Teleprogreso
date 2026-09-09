import { urlArchivo } from '../../api/client'
import Badge from '../ui/Badge'
import { MaterialMiniatura } from './MiniaturaActivo'
import { IconEdit, IconTrash } from './InventarioIcons'
import TablaFiltrable from './TablaFiltrable'
import styles from './TablaMateriales.module.css'

const IconBox = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)

export default function TablaMateriales({
  datos = [],
  loading = false,
  sortConfig = { key: null, dir: 'asc' },
  onSort,
  onEditar,
  onEliminar,
}) {
  const columns = [
    {
      key: 'nombre_activo',
      label: 'Material',
      render: m => (
        <div className={styles.activoCell}>
          <MaterialMiniatura tipo={m.tipo_material} foto={urlArchivo(m.foto_url)} />
          <span className={styles.activoNombre}>{m.nombre_activo}</span>
        </div>
      ),
    },
    {
      key: 'tipo_material',
      label: 'Tipo',
      sortable: true,
      render: m => <span className={styles.tipoTag}>{m.tipo_material || '—'}</span>,
    },
    {
      key: 'unidad_medida',
      label: 'Unidad',
      sortable: true,
      render: m => <span className={styles.textoSecundario}>{m.unidad_medida || '—'}</span>,
    },
    {
      key: 'cantidad_disponible',
      label: 'Disponible',
      sortable: true,
      render: m => {
        const stockBajo = m.cantidad_disponible <= m.stock_minimo
        return (
          <span className={`${styles.cantidadNum} ${stockBajo ? styles.cantidadBaja : ''}`}>
            {m.cantidad_disponible?.toLocaleString()}
          </span>
        )
      },
    },
    {
      key: 'stock_minimo',
      label: 'Stock mínimo',
      render: m => <span className={styles.textoSecundario}>{m.stock_minimo?.toLocaleString()}</span>,
    },
    {
      key: 'nivel_stock',
      label: 'Nivel de stock',
      render: m => {
        const stockBajo = m.cantidad_disponible <= m.stock_minimo
        const pct = Math.min(100, Math.round((m.cantidad_disponible / Math.max(m.stock_minimo * 3, 1)) * 100))
        return (
          <div className={styles.stockBarWrap}>
            <div className={styles.stockBar}>
              <div
                className={`${styles.stockBarFill} ${stockBajo ? styles.stockBarBajo : styles.stockBarOk}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <Badge label={stockBajo ? 'Stock bajo' : 'Normal'} variant={stockBajo ? 'danger' : 'success'} />
          </div>
        )
      },
    },
    {
      key: 'acciones',
      label: 'Acciones',
      align: 'right',
      render: m => (
        <div className={styles.actionBtns}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEditar(m)} title="Editar material" aria-label={`Editar ${m.nombre_activo}`}>
            <IconEdit />
          </button>
          <button type="button" className="btn btn-soft-danger btn-sm" onClick={() => onEliminar(m)} title="Eliminar material" aria-label={`Eliminar ${m.nombre_activo}`}>
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
      rowKey={m => m.id_activo}
      loadingLabel="Cargando materiales..."
      emptyIcon={<IconBox />}
      emptyTitle="Sin materiales"
      emptyDescription="No se encontraron materiales con esos criterios de búsqueda."
      footerLabel={n => `Mostrando ${n} material${n !== 1 ? 'es' : ''}`}
    />
  )
}
