import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import LeyendaMapaSupervisor from '../components/mapa/LeyendaMapaSupervisor'
import { ORDEN_ESTADOS } from '../components/mapa/estadoColor'

const servicios = [
  { estado: 'pendiente' },
  { estado: 'pendiente' },
  { estado: 'en_progreso' },
  { estado: 'completado' },
]

const tecnicos = [
  { estado: 'disponible' },
  { estado: 'disponible' },
  { estado: 'en_tarea' },
]

describe('LeyendaMapaSupervisor', () => {
  it('muestra el contador y el total de tareas por estado', () => {
    render(<LeyendaMapaSupervisor servicios={servicios} estados={ORDEN_ESTADOS} />)

    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('tareas visibles')).toBeInTheDocument()
    expect(screen.getByText('Pendiente').closest('li')).toHaveTextContent('2')
    expect(screen.getByText('Completado').closest('li')).toHaveTextContent('1')
    expect(screen.getByText('Cancelado').closest('li')).toHaveTextContent('0')
  })

  it('no muestra la sección de técnicos si no se le pasan técnicos', () => {
    render(<LeyendaMapaSupervisor servicios={servicios} estados={ORDEN_ESTADOS} />)

    expect(screen.queryByText('Técnicos en el mapa')).not.toBeInTheDocument()
  })

  it('agrega la sección de técnicos con su total por estado cuando hay técnicos visibles', () => {
    render(
      <LeyendaMapaSupervisor
        servicios={servicios}
        estados={ORDEN_ESTADOS}
        tecnicos={tecnicos}
      />
    )

    expect(screen.getByText('Técnicos en el mapa')).toBeInTheDocument()
    expect(screen.getByText('Disponible').closest('li')).toHaveTextContent('2')
    expect(screen.getByText('En tarea').closest('li')).toHaveTextContent('1')
    expect(screen.getByText('En pausa').closest('li')).toHaveTextContent('0')
  })
})