"""
Pruebas de los catálogos de datos del seed — SCRUM-180.

El seed no se puede ejecutar en CI (necesita PostGIS levantado), pero sus
catálogos sí son datos puros y ahí es donde se cuelan los errores caros:

  - una coordenada con lat y lon invertidas. `punto(lat, lon)` escribe
    "POINT(lon lat)" porque es el orden que espera PostGIS, así que un par
    cambiado no falla al insertar: simplemente deja el marcador en el océano
    Índico y nadie lo nota hasta abrir el mapa.
  - una tarea del catálogo sin `fecha_completado`, que la vuelve invisible
    para los tres reportes aunque su estado diga "completado".
"""

import seed

# Caja que encierra el municipio de Fraijanes, Guatemala, con holgura.
# Cualquier punto fuera de aquí es un error de captura, no una aldea lejana.
LAT_MIN, LAT_MAX = 14.40, 14.55
LON_MIN, LON_MAX = -90.52, -90.38


def _dentro_de_fraijanes(lat: float, lon: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


class TestZonasFraijanes:
    def test_todas_las_zonas_caen_dentro_del_municipio(self):
        for zona in seed.ZONAS_FRAIJANES:
            assert _dentro_de_fraijanes(zona["lat"], zona["lon"]), (
                f"La zona '{zona['zona']}' cae fuera de Fraijanes: "
                f"{zona['lat']}, {zona['lon']} — ¿lat y lon invertidas?"
            )

    def test_cada_zona_tiene_nombre(self):
        for zona in seed.ZONAS_FRAIJANES:
            assert zona["zona"].strip()

    def test_no_hay_zonas_repetidas(self):
        nombres = [z["zona"] for z in seed.ZONAS_FRAIJANES]
        assert len(nombres) == len(set(nombres))


class TestPuntoWKT:
    def test_escribe_longitud_antes_que_latitud(self):
        # PostGIS espera POINT(lon lat); invertirlo es el bug silencioso que
        # esta prueba existe para atrapar.
        assert seed.punto(14.4744, -90.4425) == "SRID=4326;POINT(-90.4425 14.4744)"


class TestTareasDemo:
    def test_todas_las_tareas_tienen_coordenada_en_fraijanes(self):
        for tarea in seed.TAREAS:
            wkt = tarea["coordenada"]
            lon, lat = wkt.removeprefix("SRID=4326;POINT(").rstrip(")").split()
            assert _dentro_de_fraijanes(float(lat), float(lon)), (
                f"'{tarea['titulo']}' tiene una coordenada fuera de Fraijanes"
            )

    def test_las_completadas_traen_fecha_completado(self):
        # Sin esta marca la tarea no aparece en /reportes/tareas-completadas,
        # ni en /reportes/productividad, ni en el historial diario.
        completadas = [t for t in seed.TAREAS if t["estado_tarea"] == "completado"]
        assert completadas, "El escenario debe incluir tareas completadas"

        for tarea in completadas:
            assert tarea.get("fecha_completado") is not None, (
                f"'{tarea['titulo']}' está completada pero sin fecha_completado"
            )

    def test_las_no_completadas_no_traen_fecha_completado(self):
        for tarea in seed.TAREAS:
            if tarea["estado_tarea"] != "completado":
                assert tarea.get("fecha_completado") is None, (
                    f"'{tarea['titulo']}' no está completada y no debería "
                    f"tener fecha de cierre"
                )

    def test_la_fecha_de_cierre_no_es_futura(self):
        for tarea in seed.TAREAS:
            cierre = tarea.get("fecha_completado")
            if cierre is not None:
                assert cierre.date() <= seed.HOY


class TestCatalogoHistorico:
    def test_hay_varias_semanas_de_historial(self):
        # "Varias semanas" es el requisito de SCRUM-180: con menos de un mes
        # no se puede probar un reporte mensual.
        assert seed.SEMANAS_HISTORIAL >= 4

    def test_asistencia_cubre_el_mismo_rango_que_las_tareas(self):
        # Si la asistencia fuera más corta, el reporte de productividad
        # dividiría tareas entre horas que no existen.
        import inspect

        firma = inspect.signature(seed.crear_historial_asistencia)
        dias_por_defecto = firma.parameters["dias"].default
        assert dias_por_defecto >= seed.SEMANAS_HISTORIAL * 7

    def test_los_ritmos_cubren_de_cero_a_tres_tareas(self):
        for nombre, pesos in seed.RITMOS.items():
            assert len(pesos) == 4, f"El ritmo '{nombre}' debe tener 4 pesos"
            assert all(p >= 0 for p in pesos)
            assert sum(pesos) > 0

    def test_cada_tecnico_tiene_un_ritmo_conocido(self):
        for ritmo in seed.RITMO_POR_TECNICO:
            assert ritmo in seed.RITMOS

    def test_los_ritmos_se_diferencian_entre_si(self):
        # Si todos los técnicos rindieran igual, el reporte de productividad
        # saldría plano y no serviría para comparar a nadie.
        assert len(set(seed.RITMO_POR_TECNICO)) > 1

    def test_el_catalogo_de_servicios_esta_completo(self):
        assert len(seed.SERVICIOS_HISTORICOS) >= 5
        for trabajo in seed.SERVICIOS_HISTORICOS:
            assert trabajo["servicio"].strip()
            # La evidencia es opcional a propósito, pero si viene, con texto.
            if trabajo["evidencia"] is not None:
                assert trabajo["evidencia"].strip()

    def test_hay_clientes_suficientes_para_no_repetir_titulos(self):
        assert len(seed.CLIENTES_HISTORICOS) >= 10
        assert len(seed.CLIENTES_HISTORICOS) == len(set(seed.CLIENTES_HISTORICOS))
