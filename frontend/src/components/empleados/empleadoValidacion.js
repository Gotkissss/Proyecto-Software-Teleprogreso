/**
 * components/empleados/empleadoValidacion.js
 * ---------------------------------------------------------------------------
 * Constantes y helpers de validación compartidos entre ModalCrearEmpleado y
 * ModalEditarEmpleado. Antes ROLES/ROL_LABEL estaban duplicados en ambos
 * archivos y ModalEditarEmpleado importaba getPasswordStrength directamente
 * desde ModalCrearEmpleado.jsx (acoplamiento entre dos componentes modal).
 * ---------------------------------------------------------------------------
 */

import { hoyISO } from '../../utils/fecha'

export const ROLES = ['admin', 'supervisor', 'tecnico', 'gerente']

export const ROL_LABEL = {
  admin:      'Admin',
  supervisor: 'Supervisor',
  tecnico:    'Técnico',
  gerente:    'Gerente',
}

/* ── Nombre y teléfono (RTF-01 / R1-3 y R1-4) ─────────────────────────────
 *
 * Las mismas reglas que `app/core/reglas.py` del backend, que sigue siendo
 * quien manda. Están aquí para avisar junto al campo en vez de devolver un
 * 422 genérico con el formulario entero marcado.
 *
 * La revisión encontró al empleado «1235 Fonzi» y nombres como «@@@»: solo se
 * comprobaba que no estuvieran vacíos. Y el teléfono exigía 7 dígitos, así que
 * había registrados de 10 — que no son un número de Guatemala y nadie puede
 * marcar.
 */
// Letras con tildes y ñ, espacios, guiones, apóstrofos y puntos: «D'León»,
// «Pérez-Luna» y «de la Cruz» son nombres reales.
const PATRON_NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ '\-.]*$/

export const MIN_LETRAS_NOMBRE = 2
export const DIGITOS_TELEFONO = 8

/** Mensaje de error del nombre o apellido, o null si está bien. */
export function errorNombre(valor, campo = 'nombre') {
  const limpio = (valor ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) return `El ${campo} es obligatorio.`
  if (!PATRON_NOMBRE.test(limpio)) {
    return `El ${campo} solo puede llevar letras, espacios, guiones y apóstrofos.`
  }
  const letras = (limpio.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length
  if (letras < MIN_LETRAS_NOMBRE) {
    return `El ${campo} debe tener al menos ${MIN_LETRAS_NOMBRE} letras.`
  }
  return null
}

/** Mensaje de error del teléfono, o null. Vacío es válido: es opcional. */
export function errorTelefono(valor) {
  const crudo = (valor ?? '').trim()
  if (!crudo) return null

  let local = crudo
  if (local.startsWith('+502')) local = local.slice(4)
  const digitos = local.replace(/\D/g, '')

  if (digitos.length !== DIGITOS_TELEFONO) {
    return `El teléfono debe tener ${DIGITOS_TELEFONO} dígitos. Formato: 1234-5678.`
  }
  return null
}

/**
 * Valida el formulario completo de creación de empleado (incluye contraseña
 * y fecha de contratación, campos que no existen en la edición).
 */
export function validarFormulario(form) {
  const errores = {}
  const errNombre = errorNombre(form.nombre, 'nombre')
  if (errNombre) errores.nombre = errNombre

  const errApellido = errorNombre(form.apellido, 'apellido')
  if (errApellido) errores.apellido = errApellido

  if (!form.correo.trim()) errores.correo = 'El correo electrónico es obligatorio.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())) errores.correo = 'Ingresa un correo electrónico válido.'

  const errTelefono = errorTelefono(form.telefono)
  if (errTelefono) errores.telefono = errTelefono

  if (!form.contrasena) errores.contrasena = 'La contraseña es obligatoria.'
  else if (form.contrasena.length < 8) errores.contrasena = 'La contraseña debe tener al menos 8 caracteres.'
  else if (!/[A-Z]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos una letra mayúscula.'
  else if (!/[a-z]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos una letra minúscula.'
  else if (!/[0-9]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos un número.'

  if (!form.confirmar_contrasena) errores.confirmar_contrasena = 'Confirma la contraseña.'
  else if (form.contrasena !== form.confirmar_contrasena) errores.confirmar_contrasena = 'Las contraseñas no coinciden.'

  if (!form.fecha_contratacion) errores.fecha_contratacion = 'La fecha de contratación es obligatoria.'
  else if (form.fecha_contratacion > hoyISO()) errores.fecha_contratacion = 'La fecha no puede ser en el futuro.'
  return errores
}

/**
 * Valida solo los campos editables desde ModalEditarEmpleado (sin
 * contraseña ni fecha de contratación).
 */
export function validarFormularioEdicion(form) {
  const errores = {}
  // Las mismas reglas que al crear: si editar fuera más permisivo, el
  // agujero seguiría abierto por la otra puerta.
  const errNombre = errorNombre(form.nombre, 'nombre')
  if (errNombre) errores.nombre = errNombre

  const errApellido = errorNombre(form.apellido, 'apellido')
  if (errApellido) errores.apellido = errApellido

  if (!form.correo.trim())   errores.correo   = 'El correo es obligatorio.'
  if (form.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) errores.correo = 'Ingresa un correo válido.'

  const errTelefono = errorTelefono(form.telefono)
  if (errTelefono) errores.telefono = errTelefono

  return errores
}

export function getPasswordStrength(pass) {
  if (!pass) return { level: 0, label: '', color: '' }
  let score = 0
  if (pass.length >= 8)  score++
  if (pass.length >= 12) score++
  if (/[A-Z]/.test(pass)) score++
  if (/[a-z]/.test(pass)) score++
  if (/[0-9]/.test(pass)) score++
  if (/[^A-Za-z0-9]/.test(pass)) score++
  if (score <= 2) return { level: 1, label: 'Débil',  color: 'var(--color-danger)' }
  if (score <= 4) return { level: 2, label: 'Media',  color: 'var(--color-warning)' }
  return              { level: 3, label: 'Fuerte', color: 'var(--color-success)' }
}
