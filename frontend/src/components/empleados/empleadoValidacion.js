/**
 * components/empleados/empleadoValidacion.js
 * ---------------------------------------------------------------------------
 * Constantes y helpers de validación compartidos entre ModalCrearEmpleado y
 * ModalEditarEmpleado. Antes ROLES/ROL_LABEL estaban duplicados en ambos
 * archivos y ModalEditarEmpleado importaba getPasswordStrength directamente
 * desde ModalCrearEmpleado.jsx (acoplamiento entre dos componentes modal).
 * ---------------------------------------------------------------------------
 */

export const ROLES = ['admin', 'supervisor', 'tecnico', 'gerente']

export const ROL_LABEL = {
  admin:      'Admin',
  supervisor: 'Supervisor',
  tecnico:    'Técnico',
  gerente:    'Gerente',
}

/**
 * Valida el formulario completo de creación de empleado (incluye contraseña
 * y fecha de contratación, campos que no existen en la edición).
 */
export function validarFormulario(form) {
  const errores = {}
  if (!form.nombre.trim()) errores.nombre = 'El nombre es obligatorio.'
  else if (form.nombre.trim().length < 2) errores.nombre = 'El nombre debe tener al menos 2 caracteres.'

  if (!form.apellido.trim()) errores.apellido = 'El apellido es obligatorio.'
  else if (form.apellido.trim().length < 2) errores.apellido = 'El apellido debe tener al menos 2 caracteres.'

  if (!form.correo.trim()) errores.correo = 'El correo electrónico es obligatorio.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())) errores.correo = 'Ingresa un correo electrónico válido.'

  if (form.telefono.trim()) {
    const digitos = form.telefono.replace(/\D/g, '')
    if (digitos.length < 7) errores.telefono = 'El teléfono debe tener al menos 7 dígitos.'
    else if (!/^[0-9+\-() ]+$/.test(form.telefono.trim())) errores.telefono = 'Solo se permiten dígitos, espacios, +, - y ().'
  }

  if (!form.contrasena) errores.contrasena = 'La contraseña es obligatoria.'
  else if (form.contrasena.length < 8) errores.contrasena = 'La contraseña debe tener al menos 8 caracteres.'
  else if (!/[A-Z]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos una letra mayúscula.'
  else if (!/[a-z]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos una letra minúscula.'
  else if (!/[0-9]/.test(form.contrasena)) errores.contrasena = 'Debe contener al menos un número.'

  if (!form.confirmar_contrasena) errores.confirmar_contrasena = 'Confirma la contraseña.'
  else if (form.contrasena !== form.confirmar_contrasena) errores.confirmar_contrasena = 'Las contraseñas no coinciden.'

  if (!form.fecha_contratacion) errores.fecha_contratacion = 'La fecha de contratación es obligatoria.'
  else {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const fecha = new Date(form.fecha_contratacion + 'T12:00:00')
    if (fecha > hoy) errores.fecha_contratacion = 'La fecha no puede ser en el futuro.'
  }
  return errores
}

/**
 * Valida solo los campos editables desde ModalEditarEmpleado (sin
 * contraseña ni fecha de contratación).
 */
export function validarFormularioEdicion(form) {
  const errores = {}
  if (!form.nombre.trim())   errores.nombre   = 'El nombre es obligatorio.'
  if (!form.apellido.trim()) errores.apellido = 'El apellido es obligatorio.'
  if (!form.correo.trim())   errores.correo   = 'El correo es obligatorio.'
  if (form.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) errores.correo = 'Ingresa un correo válido.'
  if (form.telefono && !/^[0-9+\-() ]{7,}$/.test(form.telefono.trim())) errores.telefono = 'Teléfono inválido (mín. 7 dígitos).'
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
