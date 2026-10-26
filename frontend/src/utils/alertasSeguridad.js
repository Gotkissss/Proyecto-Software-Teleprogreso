/**
 * utils/alertasSeguridad.js
 * ---------------------------------------------------------------------------
 * Cómo se muestra cada alerta de seguridad (HU-S10-05) y a qué parte de la
 * bitácora lleva para investigarla.
 *
 * La referencia viene del backend con forma "entidad:valor":
 *   correo:<correo>, ip:<ip>, empleado:<id>, bitacora:<id>, proceso:auditoria,
 *   bd:<usuario>. Su `referencia_label` ya es legible (el correo, la IP o el
 *   nombre del empleado).
 * ---------------------------------------------------------------------------
 */
import { TIPO_ALERTA_SEGURIDAD as T } from '../api/alertaService'

const RUTA_BITACORA = '/supervisor/bitacora'

export const TIPO_ALERTA_SEGURIDAD_INFO = {
  [T.LOGIN_FALLIDO]: {
    label: 'Intentos de acceso',
    describir: (valor, entidad) =>
      entidad === 'ip'
        ? `Muchos inicios de sesión fallidos desde la IP ${valor} en pocos minutos.`
        : `Muchos inicios de sesión fallidos contra ${valor} en pocos minutos.`,
    filtros: () => ({ accion: 'login_fallido' }),
  },
  [T.LOGIN_BLOQUEADO]: {
    label: 'Cuenta bloqueada',
    describir: (valor) => `Se bloqueó el acceso a ${valor} por exceso de intentos.`,
    filtros: () => ({ accion: 'login_bloqueado' }),
  },
  [T.ACCESO_DENEGADO]: {
    label: 'Accesos denegados',
    describir: (valor) => `${valor} intentó varias veces abrir lo que su rol no permite.`,
    filtros: (id) => ({ accion: 'acceso_denegado', actor: id }),
  },
  [T.CUENTA_ADMIN]: {
    label: 'Cuenta de administrador',
    describir: (valor) =>
      `Otra persona cambió la cuenta de administrador de ${valor} (contraseña o rol).`,
    filtros: (id) => ({ entidad: 'empleado', id_entidad: id }),
  },
  [T.BITACORA_ROTA]: {
    label: 'Bitácora alterada',
    describir: (valor) => `La cadena de la bitácora no cuadra desde la fila #${valor}.`,
    filtros: () => ({}),
  },
  [T.AUDITORIA_FALLIDA]: {
    label: 'Auditoría sin guardar',
    describir: () => 'El backend no pudo guardar eventos de la bitácora. Revisa el log del servidor.',
    filtros: () => ({}),
  },
  [T.CONEXION_PRIVILEGIADA]: {
    label: 'Conexión privilegiada',
    describir: (valor) =>
      `El backend se conecta a la base como «${valor}», que puede alterar la bitácora.`,
    filtros: () => ({}),
  },
}

function partes(alerta) {
  const [entidad, ...resto] = (alerta?.referencia ?? '').split(':')
  return { entidad, valor: resto.join(':') }
}

/** Mensaje de una alerta de seguridad, o null si el tipo no es de seguridad. */
export function describirAlertaSeguridad(alerta) {
  const info = TIPO_ALERTA_SEGURIDAD_INFO[alerta?.tipo]
  if (!info) return null
  const { entidad, valor } = partes(alerta)
  return info.describir(alerta.referencia_label || valor, entidad)
}

/** Enlace a la bitácora con los filtros que sirven para investigar la alerta. */
export function enlaceBitacora(alerta) {
  const info = TIPO_ALERTA_SEGURIDAD_INFO[alerta?.tipo]
  const { valor } = partes(alerta)
  const filtros = info ? info.filtros(valor) : {}
  const consulta = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => v !== undefined && v !== '')
  ).toString()
  return consulta ? `${RUTA_BITACORA}?${consulta}` : RUTA_BITACORA
}
