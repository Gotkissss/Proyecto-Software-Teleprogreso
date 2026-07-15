/**
 * Servicio para consumir el endpoint del equipo asignado al técnico.
 *
 * SCRUM-129: GET /empleados/mi-equipo
 *   Retorna el vehículo y herramientas asignadas al técnico autenticado.
 *
 * El endpoint está implementado en el backend.
 */

import apiClient from './client'

/**
 * Obtiene el vehículo y herramientas asignadas al técnico autenticado.
 * Endpoint: GET /empleados/mi-equipo
 *
 * @returns {{ vehiculo: object|null, herramientas: object[] }}
 */
export async function getMiEquipo() {
  const { data } = await apiClient.get('/empleados/mi-equipo')
  return {
    vehiculo:     data?.vehiculo     ?? null,
    herramientas: Array.isArray(data?.herramientas) ? data.herramientas : [],
  }
}