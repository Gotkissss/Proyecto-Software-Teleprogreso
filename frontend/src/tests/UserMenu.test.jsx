/**
 * tests/UserMenu.test.jsx
 * ---------------------------------------------------------------------------
 * El menú del avatar es la única puerta al perfil, y vive en los dos layouts
 * con una ruta distinta en cada uno (/perfil para el técnico,
 * /supervisor/perfil para el panel). Si el enlace apuntara al mismo sitio en
 * los dos, uno de los dos roles caería en el 404 → redirect a "/".
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import UserMenu from '../components/layout/shared/UserMenu'

const USUARIO = {
  id_empleado: 7,
  nombre: 'Ana López',
  correo: 'ana@teleprogreso.com',
  rol: 'tecnico',
}

function montar(props = {}) {
  return render(
    <MemoryRouter>
      <UserMenu user={USUARIO} onLogout={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

async function abrirMenu() {
  const user = userEvent.setup()
  // El nombre accesible del botón cambia entre variantes (solo la inicial en
  // móvil, inicial + nombre + rol en desktop); el title es el mismo en las dos.
  await user.click(screen.getByTitle('Ana López'))
  return user
}

describe('UserMenu', () => {
  it('no pinta nada sin usuario', () => {
    const { container } = render(
      <MemoryRouter>
        <UserMenu user={null} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('en el layout del técnico lleva a /perfil', async () => {
    montar({ variant: 'app' })
    await abrirMenu()

    expect(screen.getByRole('menuitem', { name: /mi perfil/i }))
      .toHaveAttribute('href', '/perfil')
  })

  it('en el layout del supervisor lleva a /supervisor/perfil', async () => {
    montar({ variant: 'supervisor' })
    await abrirMenu()

    expect(screen.getByRole('menuitem', { name: /mi perfil/i }))
      .toHaveAttribute('href', '/supervisor/perfil')
  })

  it('sigue ofreciendo cerrar sesión', async () => {
    const onLogout = vi.fn()
    montar({ onLogout })
    const user = await abrirMenu()

    await user.click(screen.getByRole('menuitem', { name: /cerrar sesión/i }))

    expect(onLogout).toHaveBeenCalled()
  })

  it('al elegir "Mi perfil" el menú se cierra', async () => {
    montar()
    const user = await abrirMenu()

    await user.click(screen.getByRole('menuitem', { name: /mi perfil/i }))

    expect(screen.queryByRole('menuitem', { name: /cerrar sesión/i })).not.toBeInTheDocument()
  })
})
