import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-leaflet', () => ({
  Marker: ({ children, position }) => <div data-testid="marker" data-pos={position.join(',')}>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
}))

import MarcadorTecnico from '../components/mapa/MarcadorTecnico'
import { iconoTecnico } from '../components/mapa/iconoMarcador'
import { ESTADO_TECNICO_COLOR } from '../components/mapa/estadoColor'

const tecnico = {
  id_empleado: 7,
  nombre: 'Ana López',
  lat: 14.6349,
  lng: -90.5069,
  fecha_hora_registro: '2026-09-23T09:45:12',
  estado: 'en_tarea',
}

describe('MarcadorTecnico', () => {
  it('muestra nombre, estado y hora del último reporte', () => {
    render(<MarcadorTecnico tecnico={tecnico} />)

    expect(screen.getByText('Ana López')).toBeInTheDocument()
    expect(screen.getByText('En tarea')).toBeInTheDocument()
    expect(screen.getByText(/09:45/)).toBeInTheDocument()
  })

  it('se ubica en la coordenada del técnico', () => {
    render(<MarcadorTecnico tecnico={tecnico} />)

    expect(screen.getByTestId('marker')).toHaveAttribute('data-pos', '14.6349,-90.5069')
  })

  it('no pinta nada si faltan coordenadas', () => {
    const { container } = render(<MarcadorTecnico tecnico={{ ...tecnico, lat: null }} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('iconoTecnico', () => {
  it('reutiliza la instancia por estado y usa el color del estado', () => {
    expect(iconoTecnico('en_pausa')).toBe(iconoTecnico('en_pausa'))
    expect(iconoTecnico('en_pausa')).not.toBe(iconoTecnico('disponible'))
    expect(iconoTecnico('en_pausa').options.html).toContain(ESTADO_TECNICO_COLOR.en_pausa)
  })
})