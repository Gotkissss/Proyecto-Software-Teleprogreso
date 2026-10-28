/**
 * utils/vehiculo.js
 * ---------------------------------------------------------------------------
 * RTF-01 / R3-11: la pantalla de Equipo dibujaba siempre la misma silueta de
 * sedán, así que la pick-up Toyota Hilux del técnico aparecía como un carro
 * particular. En una empresa de campo el vehículo es parte de la identidad del
 * puesto, y el dibujo decía otra cosa de la que el técnico tiene aparcada.
 *
 * El catálogo de activos no guarda el tipo de carrocería —solo marca, modelo y
 * nombre—, así que se deduce del texto. Es una heurística, y como tal puede
 * fallar con un modelo que no esté en la lista: por eso el respaldo es la
 * silueta genérica, que es exactamente lo que había antes. La solución
 * completa sería un campo «tipo» en el alta del vehículo; esto no lo impide.
 * ---------------------------------------------------------------------------
 */

/** Modelos de pick-up frecuentes en flotas de Guatemala. */
const PICKUP = [
  'hilux', 'pick up', 'pick-up', 'pickup', 'ranger', 'frontier', 'navara',
  'l200', 'd-max', 'dmax', 'tacoma', 'colorado', 'silverado', 'f-150', 'f150',
  'amarok', 'bt-50', 'triton', 'np300', 'rodeo',
]

/** Furgonetas y camiones ligeros de reparto. */
const PANEL = [
  'panel', 'furgon', 'furgón', 'van', 'hiace', 'transit', 'sprinter',
  'ducato', 'h100', 'h-100', 'porter', 'camion', 'camión', 'nhr', 'elf',
]

/**
 * Tipo de carrocería deducido del vehículo.
 *
 * @param {{marca?:string, modelo?:string, nombre_activo?:string, descripcion?:string}} vehiculo
 * @returns {'pickup'|'panel'|'sedan'}
 */
export function tipoDeVehiculo(vehiculo) {
  const texto = [
    vehiculo?.nombre_activo,
    vehiculo?.marca,
    vehiculo?.modelo,
    vehiculo?.descripcion,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!texto) return 'sedan'
  // El panel se comprueba primero: «panel» aparece en nombres que también
  // llevan la marca de una pick-up («Nissan NP300 panel»), y de los dos el
  // más específico es el que describe la carrocería.
  if (PANEL.some((p) => texto.includes(p))) return 'panel'
  if (PICKUP.some((p) => texto.includes(p))) return 'pickup'
  return 'sedan'
}
