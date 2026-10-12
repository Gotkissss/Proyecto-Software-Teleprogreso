/**
 * tests/ReportesPage.test.jsx
 * ---------------------------------------------------------------------------
 * HU-S9-04: la pantalla de reportes de gerencia.
 * - indicadores con su variación contra el periodo anterior
 * - el rango (atajos o fechas) manda sobre todo; uno al revés no se pide
 * - tendencia por métrica y agrupación
 * - tabla ordenable con detalle de la persona elegida
 * - el Excel hereda los filtros de la pantalla
 * ---------------------------------------------------------------------------
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const servicio = vi.hoisted(() => ({
  getResumenConComparacion: vi.fn(),
  getReporteProductividad: vi.fn(),
  getSerieReporte: vi.fn(),
  getReporteAsistencia: vi.fn(),
  getReporteTareasCompletadas: vi.fn(),
}))
const { exportarReporteMock } = vi.hoisted(() => ({ exportarReporteMock: vi.fn() }))

vi.mock('../api/reporteService', () => servicio)
vi.mock('../utils/exportarReportes', async (importOriginal) => ({
  ...(await importOriginal()),
  exportarReporte: exportarReporteMock,
}))

import { ToastProvider } from '../components/ui/Toast'
import ReportesPage from '../pages/ReportesPage'
import { rangoRapido } from '../utils/exportarReportes'

function persona(id, nombre, minutos, tareas, tph) {
  return {
    id_empleado: id,
    nombre_empleado: nombre,
    jornadas: 5,
    jornadas_abiertas: 0,
    minutos_trabajados: minutos,
    horas_trabajadas: `${String(Math.floor(minutos / 60)).padStart(2, '0')}:00`,
    descansos: 4,
    minutos_descanso: 60,
    horas_descanso: '01:00',
    tareas_completadas: tareas,
    tareas_por_hora: tph,
  }
}

const RESUMEN = {
  total_empleados: 2,
  total_jornadas: 10,
  total_jornadas_abiertas: 1,
  total_minutos_trabajados: 4800,
  total_horas_trabajadas: '80:00',
  total_descansos: 8,
  total_minutos_descanso: 120,
  total_horas_descanso: '02:00',
  total_tareas_completadas: 30,
  tareas_por_hora: 0.38,
  items: [persona(2, 'Ana López', 2400, 10, 0.25), persona(3, 'Luis Pérez', 2400, 20, 0.5)],
}

const COMPARACION = {
  actual: RESUMEN,
  anterior: { ...RESUMEN, total_tareas_completadas: 20 },
  periodoAnterior: { fecha_inicio: '2026-09-01', fecha_fin: '2026-09-12' },
  variaciones: {
    total_minutos_trabajados: 0,
    total_tareas_completadas: 50,
    tareas_por_hora: -5,
    total_jornadas: 0,
    total_minutos_descanso: null,
    total_jornadas_abiertas: 100,
  },
}

function serie(metrica = 'horas', agrupar = 'dia') {
  return {
    metrica,
    agrupar,
    unidad: metrica === 'pausas' ? 'minutos' : metrica,
    total: 16,
    puntos: [
      { inicio: '2026-10-01', fin: '2026-10-01', valor: 8 },
      { inicio: '2026-10-02', fin: '2026-10-02', valor: 8 },
    ],
  }
}

function montar() {
  return render(
    <ToastProvider>
      <ReportesPage />
    </ToastProvider>
  )
}

const ultimaLlamada = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0]

beforeEach(() => {
  vi.clearAllMocks()
  servicio.getResumenConComparacion.mockResolvedValue(COMPARACION)
  servicio.getReporteProductividad.mockResolvedValue({
    items: [
      { id_empleado: 3, nombre_empleado: 'Luis Pérez', tareas_por_hora: 0.5, tareas_completadas: 20, horas_trabajadas: '40:00' },
      { id_empleado: 2, nombre_empleado: 'Ana López', tareas_por_hora: 0.25, tareas_completadas: 10, horas_trabajadas: '40:00' },
    ],
  })
  servicio.getSerieReporte.mockImplementation(async ({ metrica, agrupar }) => serie(metrica, agrupar))
  servicio.getReporteAsistencia.mockResolvedValue({
    total_jornadas: 5, total_jornadas_abiertas: 0, total_horas_trabajadas: '40:00',
    total_descansos: 4, total_horas_pausa: '01:00',
  })
  servicio.getReporteTareasCompletadas.mockResolvedValue({ total_tareas_completadas: 10 })
  exportarReporteMock.mockResolvedValue({ archivo: 'reporte_resumen.xlsx' })
})

describe('indicadores', () => {
  it('pide el mes en curso y enseña cada indicador con su variación', async () => {
    montar()
    const indicadores = await screen.findByRole('region', { name: 'Indicadores del periodo' })

    expect(ultimaLlamada(servicio.getResumenConComparacion)).toEqual(rangoRapido('mes'))
    expect(within(indicadores).getByText('80:00')).toBeInTheDocument()
    const tareas = within(indicadores).getByText('Tareas completadas').closest('article')
    expect(tareas).toHaveTextContent('30')
    expect(tareas).toHaveTextContent('+50 % vs')
    const sinBase = within(indicadores).getByText('Tiempo en descanso').closest('article')
    expect(sinBase).toHaveTextContent('Sin base para comparar')
  })
})

describe('filtros', () => {
  it('un atajo cambia el rango de todo lo que hay debajo', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByRole('region', { name: 'Indicadores del periodo' })

    await usuario.click(screen.getByRole('button', { name: 'Mes pasado' }))

    await waitFor(() =>
      expect(ultimaLlamada(servicio.getResumenConComparacion)).toEqual(rangoRapido('mes-pasado'))
    )
    expect(ultimaLlamada(servicio.getReporteProductividad)).toEqual(rangoRapido('mes-pasado'))
    expect(ultimaLlamada(servicio.getSerieReporte)).toMatchObject(rangoRapido('mes-pasado'))
  })

  it('un rango al revés se bloquea antes de llamar al backend', async () => {
    montar()
    await screen.findByRole('region', { name: 'Indicadores del periodo' })
    const llamadas = servicio.getResumenConComparacion.mock.calls.length

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2099-01-01' } })

    expect(await screen.findByText(/no puede ser posterior/)).toBeInTheDocument()
    expect(servicio.getResumenConComparacion.mock.calls.length).toBe(llamadas)
    expect(screen.getByRole('button', { name: /Exportar a Excel/ })).toBeDisabled()
  })

  it('un periodo de más de un mes se agrupa por semana', async () => {
    montar()
    await screen.findByRole('region', { name: 'Indicadores del periodo' })

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-03-31' } })

    await waitFor(() =>
      expect(ultimaLlamada(servicio.getSerieReporte)).toMatchObject({
        fecha_inicio: '2026-01-01', fecha_fin: '2026-03-31', agrupar: 'semana',
      })
    )
  })
})

describe('tendencia', () => {
  it('cambiar de métrica y de agrupación vuelve a pedir la serie', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByRole('img', { name: /Horas trabajadas por día/ })

    await usuario.click(screen.getByRole('radio', { name: 'Tareas completadas' }))
    await waitFor(() => expect(ultimaLlamada(servicio.getSerieReporte)).toMatchObject({ metrica: 'tareas' }))

    await usuario.click(screen.getByRole('radio', { name: 'Por semana' }))
    await waitFor(() =>
      expect(ultimaLlamada(servicio.getSerieReporte)).toMatchObject({ metrica: 'tareas', agrupar: 'semana' })
    )
  })

  it('los valores también se pueden leer en una tabla', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByRole('img', { name: /Horas trabajadas por día/ })

    await usuario.click(screen.getByRole('button', { name: 'Ver tabla' }))

    const tabla = screen.getByRole('table', { name: /Horas trabajadas por día/ })
    expect(within(tabla).getAllByText('8 h')).toHaveLength(2)
  })
})

describe('resumen por empleado', () => {
  it('se ordena al pulsar el encabezado de una columna', async () => {
    const usuario = userEvent.setup()
    montar()
    const tabla = await screen.findByRole('table', { name: /Resumen operativo por empleado/ })
    const nombres = () => within(tabla).getAllByRole('row').slice(1, 3).map((fila) => fila.cells[0].textContent)

    await usuario.click(within(tabla).getByRole('button', { name: 'Tareas' }))
    expect(nombres()).toEqual(['Luis Pérez', 'Ana López'])

    await usuario.click(within(tabla).getByRole('button', { name: 'Tareas' }))
    expect(nombres()).toEqual(['Ana López', 'Luis Pérez'])
  })

  it('elegir una fila abre el detalle de esa persona con sus tres reportes', async () => {
    const usuario = userEvent.setup()
    montar()
    const tabla = await screen.findByRole('table', { name: /Resumen operativo por empleado/ })

    await usuario.click(within(tabla).getByText('Ana López'))

    const detalle = await screen.findByRole('region', { name: 'Detalle de Ana López' })
    await within(detalle).findByText('Tareas completadas')
    const rango = rangoRapido('mes')
    expect(servicio.getReporteAsistencia).toHaveBeenCalledWith({ ...rango, empleado: 2 })
    expect(servicio.getReporteTareasCompletadas).toHaveBeenCalledWith({ ...rango, tecnico: 2 })
    expect(servicio.getReporteProductividad).toHaveBeenCalledWith({ ...rango, tecnico: 2 })

    await usuario.click(within(detalle).getByRole('button', { name: 'Cerrar detalle' }))
    expect(screen.queryByRole('region', { name: 'Detalle de Ana López' })).not.toBeInTheDocument()
  })
})

describe('exportación', () => {
  it('el Excel sale con el rango de la pantalla y la persona elegida', async () => {
    const usuario = userEvent.setup()
    montar()
    const tabla = await screen.findByRole('table', { name: /Resumen operativo por empleado/ })
    await usuario.click(within(tabla).getByText('Luis Pérez'))

    await usuario.click(screen.getByRole('button', { name: /Exportar a Excel/ }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Luis Pérez')).toBeInTheDocument()
    await usuario.click(within(dialogo).getByRole('button', { name: 'Descargar Excel' }))

    await waitFor(() =>
      expect(exportarReporteMock).toHaveBeenCalledWith({ tipo: 'resumen', ...rangoRapido('mes'), empleado: 3 })
    )
    expect(await screen.findByText(/Reporte descargado: reporte_resumen.xlsx/)).toBeInTheDocument()
  })
})
