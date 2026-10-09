/**
 * HU-S9-01 (tarea 4): lo que el rol no puede llamar no se enseña en el menú.
 * Cubre el filtrado de LayoutSidebar y LayoutBottomNav contra la tabla de
 * utils/permisos.js.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import LayoutSidebar from '../components/layout/shared/LayoutSidebar'
import LayoutBottomNav from '../components/layout/shared/LayoutBottomNav'

const Icono = () => <svg />

const GRUPOS = [
  {
    label: 'Operación',
    items: [
      { to: '/supervisor/dashboard', label: 'Panel', Icon: Icono },
      { to: '/supervisor/mapa', label: 'Mapa', Icon: Icono },
      { to: '/supervisor/alertas', label: 'Alertas', Icon: Icono },
    ],
  },
  {
    label: 'Trabajo',
    items: [
      { to: '/supervisor/reasignacion', label: 'Reasignar', Icon: Icono },
      { to: '/supervisor/historial-tareas', label: 'Realizadas', Icon: Icono },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/supervisor/empleados', label: 'Empleados', Icon: Icono },
      { to: '/supervisor/inventario', label: 'Inventario', Icon: Icono },
    ],
  },
]

const ITEMS_TECNICO = [
  { to: '/ruta', label: 'Ruta', Icon: Icono },
  { to: '/mapa', label: 'Mapa', Icon: Icono },
  { to: '/supervisor/empleados', label: 'Empleados', Icon: Icono },
]

function renderSidebar(rol) {
  return render(
    <MemoryRouter>
      <LayoutSidebar brand={<span>marca</span>} groups={GRUPOS} rol={rol} />
    </MemoryRouter>
  )
}

describe('LayoutSidebar filtrado por rol', () => {
  it('el supervisor ve todo lo suyo', () => {
    renderSidebar('supervisor')
    for (const nombre of ['Panel', 'Mapa', 'Alertas', 'Reasignar', 'Realizadas', 'Empleados', 'Inventario']) {
      expect(screen.getByText(nombre)).toBeInTheDocument()
    }
  })

  it('el gerente no ve Empleados, Reasignar ni Panel', () => {
    renderSidebar('gerente')
    expect(screen.queryByText('Empleados')).not.toBeInTheDocument()
    expect(screen.queryByText('Reasignar')).not.toBeInTheDocument()
    expect(screen.queryByText('Panel')).not.toBeInTheDocument()
    expect(screen.getByText('Mapa')).toBeInTheDocument()
    expect(screen.getByText('Alertas')).toBeInTheDocument()
    expect(screen.getByText('Realizadas')).toBeInTheDocument()
    expect(screen.getByText('Inventario')).toBeInTheDocument()
  })

  it('no deja títulos de grupo huérfanos', () => {
    renderSidebar('gerente')
    expect(screen.getByText('Operación')).toBeInTheDocument()
    expect(screen.getByText('Trabajo')).toBeInTheDocument()
    expect(screen.getByText('Administración')).toBeInTheDocument()

    // Un rol sin ninguna ruta del panel no ve ningún grupo.
    const { container } = renderSidebar('tecnico')
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('un rol vacío o desconocido no ve nada (falla cerrado)', () => {
    const { container } = renderSidebar('')
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('sin la prop rol no filtra', () => {
    renderSidebar(undefined)
    expect(screen.getByText('Empleados')).toBeInTheDocument()
  })
})

describe('LayoutBottomNav filtrado por rol', () => {
  function renderBottomNav(rol) {
    return render(
      <MemoryRouter>
        <LayoutBottomNav items={ITEMS_TECNICO} rol={rol} />
      </MemoryRouter>
    )
  }

  it('el técnico ve sus pestañas y no las del panel', () => {
    renderBottomNav('tecnico')
    expect(screen.getByText('Ruta')).toBeInTheDocument()
    expect(screen.getByText('Mapa')).toBeInTheDocument()
    expect(screen.queryByText('Empleados')).not.toBeInTheDocument()
  })

  it('un rol vacío no ve ninguna pestaña', () => {
    const { container } = renderBottomNav('')
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })
})