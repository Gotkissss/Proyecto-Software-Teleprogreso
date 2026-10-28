/**
 * components/tareas/PasoMaterialesUsados.jsx
 * ---------------------------------------------------------------------------
 * HU-S10-07 — El paso "materiales usados" del modal de finalizar tarea.
 *
 * Por qué existe: el stock de un material era un número que alguien editaba a
 * mano en el inventario, y usarlo en una tarea no lo bajaba. La alerta de
 * stock crítico comparaba contra una cifra que no era la del almacén, y a
 * "¿a dónde se fueron las 40 rosetas?" no había respuesta.
 *
 * Es OPCIONAL a propósito: no todas las tareas gastan material, y obligar a
 * rellenarlo lleva a teclear cualquier cosa para poder cerrar la tarea, que es
 * peor que no tener el dato.
 *
 * El formulario va en líneas (material + cantidad) y no con un campo de texto
 * libre: el backend necesita el id del material para descontar el stock, y una
 * descripción escrita a mano no se puede cruzar con el inventario.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react'
import { getMateriales } from '../../api/inventarioService'
import styles from './PasoMaterialesUsados.module.css'

const IconMas = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const IconQuitar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

/**
 * Valida las líneas antes de enviarlas.
 *
 * Se exporta para poder probarla sin montar el modal entero, igual que
 * `validarCambioContrasena`.
 *
 * @param {Array<{id_material:string|number, cantidad:string|number}>} lineas
 * @param {Array<{id_activo:number, cantidad_disponible:number}>} materiales
 * @returns {{errores: Object, limpias: Array<{id_material:number, cantidad:number}>}}
 */
export function validarMateriales(lineas, materiales = []) {
  const errores = {}
  const limpias = []
  const porId = new Map(materiales.map((m) => [Number(m.id_activo), m]))
  // Lo pedido POR MATERIAL, para avisar cuando dos líneas del mismo material
  // sumadas se pasan del stock aunque ninguna lo haga por su cuenta. El
  // backend las agrupa igual y rechazaría el cierre entero con un 409.
  const pedidoPorMaterial = new Map()

  lineas.forEach((linea, indice) => {
    const id = Number(linea.id_material)
    const cantidad = Number(linea.cantidad)

    if (!linea.id_material) {
      errores[indice] = 'Elegí el material.'
      return
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      errores[indice] = 'La cantidad tiene que ser un número mayor que 0.'
      return
    }

    const acumulado = (pedidoPorMaterial.get(id) ?? 0) + cantidad
    pedidoPorMaterial.set(id, acumulado)

    const material = porId.get(id)
    if (material && acumulado > material.cantidad_disponible) {
      errores[indice] =
        `Solo hay ${material.cantidad_disponible} en existencia.`
      return
    }

    limpias.push({ id_material: id, cantidad })
  })

  return { errores, limpias }
}

export default function PasoMaterialesUsados({
  lineas,
  onChange,
  deshabilitado = false,
  errores = {},
}) {
  const [materiales, setMateriales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)

  useEffect(() => {
    let vivo = true
    getMateriales()
      .then((lista) => {
        if (vivo) setMateriales(lista)
      })
      .catch(() => {
        // Sin el catálogo no se puede elegir material, pero la tarea se tiene
        // que poder cerrar igual: el paso es opcional. Se avisa y se deja
        // seguir, en vez de bloquear el cierre por un dato accesorio.
        if (vivo) setErrorCarga(true)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  const agregar = () =>
    onChange([...lineas, { id_material: '', cantidad: '' }])

  const quitar = (indice) =>
    onChange(lineas.filter((_, i) => i !== indice))

  const editar = (indice, campo, valor) =>
    onChange(
      lineas.map((linea, i) =>
        i === indice ? { ...linea, [campo]: valor } : linea
      )
    )

  if (errorCarga) {
    return (
      <div className={styles.aviso} role="status">
        No se pudo cargar el inventario, así que no se puede anotar el material
        usado. La tarea se cierra igual; el ajuste del stock queda para el
        supervisor.
      </div>
    )
  }

  return (
    <div className={styles.paso}>
      <p className={styles.ayuda}>
        Si gastaste material, anotalo: se descuenta del inventario al cerrar la
        tarea. Si no gastaste nada, dejalo vacío.
      </p>

      {lineas.map((linea, indice) => (
        <div className={styles.linea} key={indice}>
          <select
            className={`${styles.select} ${errores[indice] ? styles.campoError : ''}`}
            value={linea.id_material}
            onChange={(e) => editar(indice, 'id_material', e.target.value)}
            disabled={deshabilitado || cargando}
            aria-label={`Material ${indice + 1}`}
          >
            <option value="">
              {cargando ? 'Cargando materiales…' : 'Elegí un material'}
            </option>
            {materiales.map((material) => (
              <option key={material.id_activo} value={material.id_activo}>
                {material.nombre_activo} ({material.cantidad_disponible}
                {material.unidad_medida ? ` ${material.unidad_medida}` : ''})
              </option>
            ))}
          </select>

          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            className={`${styles.cantidad} ${errores[indice] ? styles.campoError : ''}`}
            value={linea.cantidad}
            onChange={(e) => editar(indice, 'cantidad', e.target.value)}
            disabled={deshabilitado}
            placeholder="Cant."
            aria-label={`Cantidad ${indice + 1}`}
          />

          <button
            type="button"
            className={styles.quitar}
            onClick={() => quitar(indice)}
            disabled={deshabilitado}
            aria-label={`Quitar material ${indice + 1}`}
          >
            <IconQuitar />
          </button>

          {errores[indice] && (
            <p className={styles.errorLinea} role="alert">{errores[indice]}</p>
          )}
        </div>
      ))}

      <button
        type="button"
        className={styles.agregar}
        onClick={agregar}
        disabled={deshabilitado}
      >
        <IconMas /> Agregar material
      </button>
    </div>
  )
}
