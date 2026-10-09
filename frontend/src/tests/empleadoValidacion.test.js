import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validarFormulario } from '../components/empleados/empleadoValidacion'

const FORM_VALIDO = {
  nombre: 'Ana',
  apellido: 'López',
  correo: 'ana@teleprogreso.com',
  telefono: '',
  contrasena: 'Clave1234',
  confirmar_contrasena: 'Clave1234',
  fecha_contratacion: '2026-10-07',
}

function errorDeFecha(fecha) {
  return validarFormulario({ ...FORM_VALIDO, fecha_contratacion: fecha }).fecha_contratacion
}

describe('validarFormulario: fecha de contratación', () => {
  beforeEach(() => {
    // 7 de octubre a las 19:30 locales: en Guatemala (UTC-6) eso ya es el día 8 en UTC.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 19, 30, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acepta la fecha de hoy', () => {
    expect(errorDeFecha('2026-10-07')).toBeUndefined()
  })

  it('acepta una fecha pasada', () => {
    expect(errorDeFecha('2026-10-06')).toBeUndefined()
  })

  it('rechaza mañana', () => {
    expect(errorDeFecha('2026-10-08')).toBe('La fecha no puede ser en el futuro.')
  })

  it('acepta hoy también temprano en la mañana', () => {
    vi.setSystemTime(new Date(2026, 9, 7, 7, 0, 0))
    expect(errorDeFecha('2026-10-07')).toBeUndefined()
  })

  it('exige la fecha', () => {
    expect(errorDeFecha('')).toBe('La fecha de contratación es obligatoria.')
  })

  it('un formulario completo y válido no da errores', () => {
    expect(validarFormulario(FORM_VALIDO)).toEqual({})
  })
})
