/**
 * pages/EmpleadosPage.jsx
 * ---------------------------------------------------------------------------
 * Gestión de empleados y consulta de historial de asistencia.
 * Arquitectura modular:
 *   - TablaEmpleados (components/empleados/TablaEmpleados)
 *   - ModalCrearEmpleado (components/empleados/ModalCrearEmpleado)
 *   - ModalEditarEmpleado (components/empleados/ModalEditarEmpleado)
 *   - ModalConfirmarToggle (components/empleados/ModalConfirmarToggle)
 *   - HistorialAsistenciaTable (components/asistencia/HistorialAsistenciaTable)
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import apiClient from '../api/client'
import { useAuth } from '../context/AuthContext'
import PageState from '../components/ui/PageState'
import { useToast } from '../components/ui/Toast'
import TablaEmpleados from '../components/empleados/TablaEmpleados'
import ModalCrearEmpleado from '../components/empleados/ModalCrearEmpleado'
import ModalEditarEmpleado from '../components/empleados/ModalEditarEmpleado'
import ModalConfirmarToggle from '../components/empleados/ModalConfirmarToggle'
import HistorialAsistenciaTable from '../components/asistencia/HistorialAsistenciaTable'
import styles from './EmpleadosPage.module.css'

const IconUserPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/>
    <line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
)

export default function EmpleadosPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabActiva = searchParams.get('tab') === 'historial' ? 'historial' : 'empleados'
  const setTab = (tab) => {
    setSearchParams(tab === 'historial' ? { tab: 'historial' } : {})
  }

  const esAdmin = user?.rol === 'admin'

  const [empleados,        setEmpleados]        = useState([])
  const [cargando,         setCargando]         = useState(true)
  const [error,            setError]            = useState(null)

  // Filtros y ordenamiento para la tabla
  const [busqueda,         setBusqueda]         = useState('')
  const [filtroRol,        setFiltroRol]        = useState('todos')
  const [filtroEstado,     setFiltroEstado]     = useState('todos')
  const [sortCol,          setSortCol]          = useState('nombre')
  const [sortDir,          setSortDir]          = useState('asc')

  // Modales
  const [mostrarCrear,     setMostrarCrear]     = useState(false)
  const [empleadoEditar,   setEmpleadoEditar]   = useState(null)
  const [empleadoToggle,   setEmpleadoToggle]   = useState(null)
  const [cargandoAccion,   setCargandoAccion]   = useState(false)
  const [errorModal,       setErrorModal]       = useState(null)

  const fetchEmpleados = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const { data } = await apiClient.get('/empleados')
      setEmpleados(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la lista de empleados.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    fetchEmpleados()
  }, [fetchEmpleados])

  // Manejador de ordenamiento
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  // Filtrado y ordenamiento de empleados
  const empleadosFiltrados = useMemo(() => {
    let result = [...empleados]

    if (filtroRol !== 'todos') {
      result = result.filter(e => e.rol === filtroRol)
    }

    if (filtroEstado !== 'todos') {
      result = result.filter(e => e.estado === filtroEstado)
    }

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim()
      result = result.filter(e =>
        `${e.nombre} ${e.apellido}`.toLowerCase().includes(q) ||
        e.correo?.toLowerCase().includes(q) ||
        e.telefono?.toLowerCase().includes(q)
      )
    }

    result.sort((a, b) => {
      let valA = a[sortCol] ?? ''
      let valB = b[sortCol] ?? ''
      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()

      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [empleados, filtroRol, filtroEstado, busqueda, sortCol, sortDir])

  // Handlers para modales
  const handleEmpleadoCreado = (nuevo) => {
    setEmpleados(prev => [nuevo, ...prev])
    setMostrarCrear(false)
    toast.success(`Empleado ${nuevo.nombre} ${nuevo.apellido} registrado exitosamente.`)
  }

  const handleGuardarEdicion = async (id, cambios) => {
    setCargandoAccion(true)
    setErrorModal(null)
    try {
      const { data } = await apiClient.patch(`/empleados/${id}`, cambios)
      setEmpleados(prev => prev.map(e => e.id_empleado === id ? { ...e, ...data } : e))
      setEmpleadoEditar(null)
      toast.success('Datos del empleado actualizados.')
    } catch (err) {
      setErrorModal(err?.response?.data?.detail || 'No se pudieron guardar los cambios.')
    } finally {
      setCargandoAccion(false)
    }
  }

  const handleConfirmarToggle = async (id, nuevoEstado) => {
    setCargandoAccion(true)
    try {
      await apiClient.patch(`/empleados/${id}/estado`, { estado: nuevoEstado })
      setEmpleados(prev => prev.map(e => e.id_empleado === id ? { ...e, estado: nuevoEstado } : e))
      setEmpleadoToggle(null)
      toast.success(
        nuevoEstado === 'activo'
          ? 'Empleado activado correctamente.'
          : 'Empleado desactivado.'
      )
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cambiar el estado del empleado.')
    } finally {
      setCargandoAccion(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Encabezado ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Gestión de Personal</h1>
          <p className={styles.subtitle}>
            Administración de colaboradores, roles y registro de asistencia
          </p>
        </div>

        {esAdmin && tabActiva === 'empleados' && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMostrarCrear(true)}
          >
            <IconUserPlus /> Nuevo empleado
          </button>
        )}
      </div>

      {/* ── Tabs de Navegación ── */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${tabActiva === 'empleados' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('empleados')}
        >
          Colaboradores ({empleados.length})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tabActiva === 'historial' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('historial')}
        >
          Historial de asistencia
        </button>
      </div>

      {/* ── Contenido de pestañas ── */}
      <div className={styles.tabContent}>
        {tabActiva === 'empleados' ? (
          cargando || error ? (
            <PageState
              loading={cargando}
              loadingLabel="Cargando colaboradores..."
              error={error}
              onRetry={fetchEmpleados}
              errorTitle="No se pudo cargar la lista de personal"
            />
          ) : (
            <TablaEmpleados
              empleados={empleadosFiltrados}
              busqueda={busqueda}
              onBusquedaChange={setBusqueda}
              filtroRol={filtroRol}
              onFiltroRolChange={setFiltroRol}
              filtroEstado={filtroEstado}
              onFiltroEstadoChange={setFiltroEstado}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              onEditar={emp => { setErrorModal(null); setEmpleadoEditar(emp) }}
              onToggle={emp => setEmpleadoToggle(emp)}
              esAdmin={esAdmin}
              totalFiltrados={empleadosFiltrados.length}
              totalGeneral={empleados.length}
            />
          )
        ) : (
          <HistorialAsistenciaTable />
        )}
      </div>

      {/* ── Modales de Empleados ── */}
      {mostrarCrear && (
        <ModalCrearEmpleado
          onCreado={handleEmpleadoCreado}
          onCerrar={() => setMostrarCrear(false)}
          empleadosExistentes={empleados}
        />
      )}

      {empleadoEditar && (
        <ModalEditarEmpleado
          empleado={empleadoEditar}
          onGuardar={handleGuardarEdicion}
          onCerrar={() => setEmpleadoEditar(null)}
          cargando={cargandoAccion}
          errorMsg={errorModal}
        />
      )}

      {empleadoToggle && (
        <ModalConfirmarToggle
          empleado={empleadoToggle}
          onConfirmar={handleConfirmarToggle}
          onCancelar={() => setEmpleadoToggle(null)}
          cargando={cargandoAccion}
        />
      )}
    </div>
  )
}
