/**
 * utils/borradorTarea.js
 * ---------------------------------------------------------------------------
 * HU-S9-05 — Lo que el técnico escribe al cerrar una tarea sobrevive a que se
 * le caiga la sesión.
 *
 * El informe de una tarea son varias líneas escritas con una mano, de pie y a
 * veces sin señal. Si la sesión vence justo al enviarlo —o el teléfono se
 * queda sin batería, o cierra la pestaña sin querer— ese texto se perdía
 * entero y había que escribirlo otra vez de memoria.
 *
 * Qué se guarda y qué no:
 *   · La descripción, que es lo que cuesta escribir.
 *   · El NOMBRE de la foto elegida, no la foto. Un archivo no cabe en
 *     localStorage (son megas, y el cupo del navegador anda por los 5 MB), así
 *     que lo único que se puede hacer es recordarle cuál había elegido para
 *     que la vuelva a seleccionar sin dudar si era esa.
 *   · Los materiales usados (HU-S10-07). Son unas pocas líneas de
 *     material y cantidad que el técnico tiene que recordar de memoria si se
 *     pierden: cuántos metros de cable y cuántas rosetas gastó en una casa no
 *     se reconstruye al día siguiente.
 *
 * Todo pasa por try/catch: en navegación privada o con el almacenamiento
 * bloqueado, `localStorage` lanza al escribir. Perder el borrador es molesto;
 * que reviente el modal de finalizar tarea, no.
 * ---------------------------------------------------------------------------
 */

const PREFIJO = 'teleprogreso:borrador-tarea:'

/** Borradores de más de un día no se reofrecen: ya no son de este trabajo. */
export const VIGENCIA_MS = 24 * 60 * 60 * 1000

export const claveBorrador = (idTarea) => `${PREFIJO}${idTarea}`

/**
 * Guarda (o borra, si no queda nada que guardar) el borrador de una tarea.
 *
 * @param {number|string} idTarea
 * @param {{descripcion?: string, nombreFoto?: string|null,
 *   materiales?: Array<{id_material:number, cantidad:number}>}} contenido
 */
export function guardarBorrador(
  idTarea,
  { descripcion = '', nombreFoto = null, materiales = [] } = {}
) {
  if (idTarea === undefined || idTarea === null) return

  const lineas = Array.isArray(materiales) ? materiales : []

  // Un borrador vacío es ruido: ocupa cupo y al volver no ofrece nada.
  if (!descripcion.trim() && !nombreFoto && lineas.length === 0) {
    borrarBorrador(idTarea)
    return
  }

  try {
    localStorage.setItem(
      claveBorrador(idTarea),
      JSON.stringify({
        descripcion,
        nombreFoto,
        materiales: lineas,
        guardadoEn: Date.now(),
      })
    )
  } catch {
    // Sin espacio o sin permiso de almacenamiento: se sigue sin borrador.
  }
}

/**
 * Borrador vigente de una tarea, o null.
 *
 * Devuelve null —y limpia— cuando está caducado o corrupto, para que un
 * localStorage de otra versión del formato no deje al modal intentando leer
 * campos que no existen.
 */
export function leerBorrador(idTarea, ahora = Date.now()) {
  if (idTarea === undefined || idTarea === null) return null

  try {
    const crudo = localStorage.getItem(claveBorrador(idTarea))
    if (!crudo) return null

    const borrador = JSON.parse(crudo)
    if (!borrador || typeof borrador !== 'object') {
      borrarBorrador(idTarea)
      return null
    }

    if (ahora - (borrador.guardadoEn ?? 0) > VIGENCIA_MS) {
      borrarBorrador(idTarea)
      return null
    }

    return {
      descripcion: typeof borrador.descripcion === 'string' ? borrador.descripcion : '',
      nombreFoto: borrador.nombreFoto ?? null,
      // Un borrador escrito antes de la HU-S10-07 no trae el campo; `[]` deja
      // el paso de materiales vacío en vez de romper el modal.
      materiales: Array.isArray(borrador.materiales) ? borrador.materiales : [],
      guardadoEn: borrador.guardadoEn ?? null,
    }
  } catch {
    borrarBorrador(idTarea)
    return null
  }
}

export function borrarBorrador(idTarea) {
  try {
    localStorage.removeItem(claveBorrador(idTarea))
  } catch {
    // Igual que arriba: no poder limpiar no puede romper nada.
  }
}
