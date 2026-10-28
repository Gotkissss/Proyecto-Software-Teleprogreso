/**
 * RTF-01 — moderados de interfaz (R1-3, R1-4, R2-6, R3-6 y R3-7).
 * ---------------------------------------------------------------------------
 * Todos del mismo tipo: la pantalla mostraba algo que no correspondía a lo
 * que el sistema hacía.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it } from 'vitest'

import {
  errorNombre,
  errorTelefono,
  validarFormularioEdicion,
} from '../components/empleados/empleadoValidacion'
import { estadoJornada, ordenarPorDisponibilidad } from '../utils/tecnicos'
import { duracionPausa } from '../components/asistencia/HistorialAsistenciaTable'
import { validarActivo } from '../components/inventario/ModalNuevoActivo'

/* ══ R1-3 — El nombre tiene que parecer un nombre ═════════════════════════ */

describe('errorNombre', () => {
  it.each(['12345', '@@@', '...', '1', 'A', 'Juan3', '', '   '])(
    'rechaza «%s»',
    (valor) => {
      expect(errorNombre(valor)).toBeTruthy()
    }
  )

  it.each(['Ana', 'María José', 'Pérez-Luna', "D'León", 'de la Cruz', 'Ñandú'])(
    'acepta «%s»',
    (valor) => {
      // El contrapeso: un patrón demasiado estricto deja a gente sin poder
      // registrarse y obliga a escribir su nombre mal.
      expect(errorNombre(valor)).toBeNull()
    }
  )

  it('el mensaje nombra el campo', () => {
    expect(errorNombre('123', 'apellido')).toMatch(/apellido/)
  })
})

/* ══ R1-4 — Teléfono de 8 dígitos ═════════════════════════════════════════ */

describe('errorTelefono', () => {
  it.each(['12345678', '1234-5678', '1234 5678', '+502 1234-5678'])(
    'acepta «%s»',
    (valor) => {
      expect(errorTelefono(valor)).toBeNull()
    }
  )

  it.each(['6767676767', '1234567', '123456789', 'abcdefgh'])(
    'rechaza «%s»',
    (valor) => {
      // 6767676767 es el del informe: 10 dígitos, que no son un número de
      // Guatemala y nadie puede marcar.
      expect(errorTelefono(valor)).toBeTruthy()
    }
  )

  it('vacío es válido: el teléfono es opcional', () => {
    expect(errorTelefono('')).toBeNull()
    expect(errorTelefono(null)).toBeNull()
  })

  it('editar aplica las mismas reglas que crear', () => {
    const errores = validarFormularioEdicion({
      nombre: '12345',
      apellido: 'López',
      correo: 'a@b.com',
      telefono: '6767676767',
    })
    expect(errores.nombre).toBeTruthy()
    expect(errores.telefono).toBeTruthy()
  })
})

/* ══ R2-6 — El selector dice si el técnico está en jornada ════════════════ */

describe('ordenarPorDisponibilidad', () => {
  const tecnico = (nombre, campos) => ({
    nombre_completo: nombre,
    tareas_activas: 0,
    ...campos,
  })

  it('primero quien está en jornada, al final quien no marcó', () => {
    const lista = [
      tecnico('Sin entrada', { en_jornada: false, marco_entrada: false }),
      tecnico('Ya salió', { en_jornada: false, marco_entrada: true }),
      tecnico('Trabajando', { en_jornada: true, marco_entrada: true }),
    ]

    expect(ordenarPorDisponibilidad(lista).map((t) => t.nombre_completo)).toEqual([
      'Trabajando',
      'Ya salió',
      'Sin entrada',
    ])
  })

  it('dentro del mismo grupo, el de menos carga primero', () => {
    const lista = [
      tecnico('Cargado', { en_jornada: true, tareas_activas: 4 }),
      tecnico('Libre', { en_jornada: true, tareas_activas: 1 }),
    ]

    expect(ordenarPorDisponibilidad(lista)[0].nombre_completo).toBe('Libre')
  })

  it('con la misma carga, ordena por nombre para que la lista no salte', () => {
    // Sin este criterio, dos técnicos iguales se intercambian de sitio entre
    // refrescos y el supervisor pierde de vista a quién iba a elegir.
    const lista = [tecnico('Zoe', { en_jornada: true }), tecnico('Ana', { en_jornada: true })]

    expect(ordenarPorDisponibilidad(lista).map((t) => t.nombre_completo)).toEqual([
      'Ana',
      'Zoe',
    ])
  })

  it('no filtra a nadie: asignar a quien no marcó es legítimo', () => {
    // Se prepara la ruta del día antes de que el técnico llegue. Lo que hacía
    // falta es que se vea, no que se impida.
    const lista = [tecnico('Sin entrada', { en_jornada: false, marco_entrada: false })]

    expect(ordenarPorDisponibilidad(lista)).toHaveLength(1)
  })

  it('aguanta una lista que no es lista', () => {
    expect(ordenarPorDisponibilidad(undefined)).toEqual([])
    expect(ordenarPorDisponibilidad(null)).toEqual([])
  })
})

describe('estadoJornada', () => {
  it('distingue los tres estados', () => {
    expect(estadoJornada({ en_jornada: true, marco_entrada: true })).toBe('en jornada')
    expect(estadoJornada({ en_jornada: false, marco_entrada: true })).toBe(
      'jornada cerrada'
    )
    expect(estadoJornada({ en_jornada: false, marco_entrada: false })).toBe(
      'sin entrada hoy'
    )
  })
})

/* ══ R3-6 — Una pausa corta no se lee como «00:00» ════════════════════════ */

describe('duracionPausa', () => {
  it('una pausa de minutos se muestra en minutos', () => {
    expect(duracionPausa({ minutos: 15, segundos: 900 })).toBe('15 min')
  })

  it('una pausa de menos de un minuto dice los segundos', () => {
    // El caso del informe: «1 descanso con 00:00 de duración». Los minutos
    // salen de una división entera, así que 40 segundos daban 0.
    expect(duracionPausa({ minutos: 0, segundos: 40 })).toBe('40 s')
  })

  it('una pausa de duración cero lo dice con palabras', () => {
    // Inicio y fin en el mismo segundo: casi siempre un doble toque.
    expect(duracionPausa({ minutos: 0, segundos: 0 })).toBe('sin duración')
  })

  it('una pausa sin el campo nuevo no rompe la tabla', () => {
    // Las respuestas en caché de antes de la corrección no traen `segundos`.
    expect(duracionPausa({ minutos: 5 })).toBe('5 min')
    expect(duracionPausa({})).toBe('sin duración')
  })
})

/* ══ R3-7 — El error se muestra junto al campo ════════════════════════════ */

describe('validarActivo', () => {
  const material = (campos = {}) => ({
    nombre_activo: 'Roseta óptica',
    placa: '',
    capacidad: '',
    cantidad_disponible: '10',
    stock_minimo: '2',
    ...campos,
  })

  it('un material correcto no da errores', () => {
    expect(validarActivo('material', material())).toEqual({})
  })

  it('señala la cantidad negativa en su propio campo', () => {
    // El informe: el backend la rechaza, pero con «Los datos enviados no son
    // válidos.» — sin decir qué campo.
    const errores = validarActivo('material', material({ cantidad_disponible: '-5' }))
    expect(errores.cantidad_disponible).toMatch(/negativa/i)
    expect(errores.stock_minimo).toBeUndefined()
  })

  it('señala el stock mínimo negativo en su propio campo', () => {
    const errores = validarActivo('material', material({ stock_minimo: '-1' }))
    expect(errores.stock_minimo).toMatch(/negativa/i)
    expect(errores.cantidad_disponible).toBeUndefined()
  })

  it('rechaza un decimal: las unidades no se parten', () => {
    const errores = validarActivo('material', material({ cantidad_disponible: '2.5' }))
    expect(errores.cantidad_disponible).toMatch(/entero/i)
  })

  it('rechaza lo que no es un número', () => {
    const errores = validarActivo('material', material({ stock_minimo: 'diez' }))
    expect(errores.stock_minimo).toMatch(/número/i)
  })

  it('el campo vacío vale: se toma como 0', () => {
    expect(validarActivo('material', material({ stock_minimo: '' }))).toEqual({})
  })

  it('el nombre del activo sigue siendo obligatorio', () => {
    const errores = validarActivo('material', material({ nombre_activo: '  ' }))
    expect(errores.nombre_activo).toBeTruthy()
  })

  it('la placa es obligatoria solo para vehículos', () => {
    expect(validarActivo('carro', material()).placa).toBeTruthy()
    expect(validarActivo('material', material()).placa).toBeUndefined()
  })
})
