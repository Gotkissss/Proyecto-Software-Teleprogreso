/**
 * pages/HistorialAsistenciaPage.jsx
 * ---------------------------------------------------------------------------
 * Ruta standalone /supervisor/asistencia.
 * La tabla filtrable y la lógica de datos viven en el componente compartido
 * HistorialAsistenciaTable (también usado dentro del tab "Historial" de
 * EmpleadosPage), para no duplicar code entre ambos puntos de entrada.
 * ---------------------------------------------------------------------------
 */

import HistorialAsistenciaTable from '../components/asistencia/HistorialAsistenciaTable'

export default function HistorialAsistenciaPage() {
  return <HistorialAsistenciaTable />
}