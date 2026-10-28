/**
 * Editar la ubicación de una tarea — T6 del Sprint 10.
 * ---------------------------------------------------------------------------
 * El backend aceptaba `lat`/`lng` en `PATCH /tareas/{id}` desde SCRUM-170,
 * pero la interfaz no los ofrecía: una tarea creada con la coordenada mal
 * puesta —o sin coordenada— no se podía arreglar sin borrarla y volver a
 * crearla, y con ella se iban su historial y sus evidencias. El técnico,
 * mientras tanto, veía el pin en otra calle o no veía ninguno.
 *
 * El mapa de Leaflet no se puede pinchar en jsdom, así que el selector se
 * sustituye por un doble que expone un botón: lo que se prueba es el contrato
 * del modal —qué manda al backend y cuándo—, no el mapa, que ya tiene sus
 * propias pruebas.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { actualizarTareaMock } = vi.hoisted(() => ({
  actualizarTareaMock: vi.fn(),
}))

vi.mock('../api/tareaService', () => ({
  actualizarTarea: actualizarTareaMock,
  LIMITE_TAREAS_FALLBACK: 5,
}))

// Doble del selector: un botón que simula el clic en el mapa y otro que
// simula mover el pin sin que Nominatim devuelva dirección.
vi.mock('../components/mapa/SelectorUbicacionMapa', () => ({
  default: ({ lat, lng, onCambiarUbicacion }) => (
    <div data-testid="selector-mapa">
      <span data-testid="punto-actual">
        {lat == null ? 'sin punto' : `${lat},${lng}`}
      </span>
      <button
        type="button"
        onClick={() =>
          onCambiarUbicacion({
            lat: 14.5,
            lng: -90.5,
            direccion: 'Avenida nueva 123',
          })
        }
      >
        simular clic en el mapa
      </button>
      <button
        type="button"
        onClick={() =>
          onCambiarUbicacion({ lat: 14.6, lng: -90.6, direccion: undefined })
        }
      >
        simular pin sin direccion
      </button>
    </div>
  ),
}))

import ModalEditarTarea from '../components/tareas/ModalEditarTarea'

const TAREA_CON_PUNTO = {
  id_tarea: 1,
  titulo: 'Instalación fibra óptica',
  descripcion: 'Acometida y ONT',
  direccion_servicio: 'Calle 15, Fraijanes',
  prioridad: 'alta',
  estado_tarea: 'pendiente',
  fecha_inicio: '2026-09-01',
  fecha_finalizacion: '2026-09-05',
  lat: 14.4728,
  lng: -90.4408,
  tecnico: { id_empleado: 2, nombre: 'Juan Pérez' },
}

const TAREA_SIN_PUNTO = { ...TAREA_CON_PUNTO, lat: null, lng: null }

function montar(tarea = TAREA_CON_PUNTO, props = {}) {
  return render(
    <ModalEditarTarea
      open
      tarea={tarea}
      onClose={vi.fn()}
      onGuardado={vi.fn()}
      {...props}
    />
  )
}

const guardar = () =>
  userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

describe('ModalEditarTarea — ubicación', () => {
  beforeEach(() => {
    actualizarTareaMock.mockReset()
    actualizarTareaMock.mockResolvedValue({ ...TAREA_CON_PUNTO })
  })

  it('parte de la coordenada que ya tiene la tarea', () => {
    montar()
    expect(screen.getByTestId('punto-actual')).toHaveTextContent(
      '14.4728,-90.4408'
    )
  })

  it('dice cuando la tarea no tiene ubicación y por qué importa', () => {
    montar(TAREA_SIN_PUNTO)
    expect(screen.getByTestId('punto-actual')).toHaveTextContent('sin punto')
    // El supervisor tiene que entender la consecuencia, no solo el hueco.
    expect(
      screen.getByText(/el técnico no la ve en su mapa/i)
    ).toBeInTheDocument()
  })

  it('mover el punto manda lat y lng juntas', async () => {
    montar()
    await userEvent.click(
      screen.getByRole('button', { name: 'simular clic en el mapa' })
    )
    await guardar()

    await waitFor(() => expect(actualizarTareaMock).toHaveBeenCalled())
    const [, cambios] = actualizarTareaMock.mock.calls[0]
    // El validador del backend las exige como par: mandar una sola es un 422.
    expect(cambios.lat).toBe(14.5)
    expect(cambios.lng).toBe(-90.5)
  })

  it('el clic en el mapa también actualiza la dirección', async () => {
    montar()
    await userEvent.click(
      screen.getByRole('button', { name: 'simular clic en el mapa' })
    )
    await guardar()

    const [, cambios] = actualizarTareaMock.mock.calls[0]
    expect(cambios.direccion).toBe('Avenida nueva 123')
  })

  it('si no llega dirección no se pisa la que había escrita', async () => {
    // `direccion: undefined` significa "la geocodificación inversa no dio
    // nada", no "bórrala".
    montar()
    await userEvent.click(
      screen.getByRole('button', { name: 'simular pin sin direccion' })
    )
    await guardar()

    const [, cambios] = actualizarTareaMock.mock.calls[0]
    expect(cambios.lat).toBe(14.6)
    expect('direccion' in cambios).toBe(false)
  })

  it('sin tocar el mapa no se manda ninguna coordenada', async () => {
    // Mandar la coordenada en cada guardado haría que editar el título
    // reescribiera la ubicación, y con ella la fila de la bitácora.
    montar()
    await userEvent.clear(screen.getByLabelText('Título *'))
    await userEvent.type(
      screen.getByLabelText('Título *'),
      'Instalación fibra óptica revisada'
    )
    await guardar()

    await waitFor(() => expect(actualizarTareaMock).toHaveBeenCalled())
    const [, cambios] = actualizarTareaMock.mock.calls[0]
    expect('lat' in cambios).toBe(false)
    expect('lng' in cambios).toBe(false)
  })

  it('"Quitar ubicación" manda las dos en null', async () => {
    montar()
    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar ubicación' })
    )
    await guardar()

    await waitFor(() => expect(actualizarTareaMock).toHaveBeenCalled())
    const [, cambios] = actualizarTareaMock.mock.calls[0]
    expect(cambios.lat).toBeNull()
    expect(cambios.lng).toBeNull()
  })

  it('una tarea sin ubicación no ofrece quitarla', () => {
    montar(TAREA_SIN_PUNTO)
    expect(
      screen.queryByRole('button', { name: 'Quitar ubicación' })
    ).not.toBeInTheDocument()
  })

  it('poner la primera ubicación a una tarea que no la tenía', async () => {
    montar(TAREA_SIN_PUNTO)
    await userEvent.click(
      screen.getByRole('button', { name: 'simular clic en el mapa' })
    )
    await guardar()

    await waitFor(() => expect(actualizarTareaMock).toHaveBeenCalled())
    const [, cambios] = actualizarTareaMock.mock.calls[0]
    expect(cambios.lat).toBe(14.5)
    expect(cambios.lng).toBe(-90.5)
  })
})
