# Cabeceras de seguridad de la página (HU-S10-06).
#
# La API ya mandaba las suyas (backend/app/core/middleware_seguridad.py), pero
# la página donde vive la sesión se servía sin ninguna. Con el JWT en
# localStorage, la CSP es lo que impide que un script ajeno corra aquí y se lo
# lleve.
#
# Se incluye en el server y en CADA location que tenga su propio add_header:
# nginx no hereda los add_header del nivel de arriba si el bloque define
# alguno, y sin el include las cabeceras se perderían en esos archivos.
#
# __API__ y __CSP_HEADER__ los reemplaza el arranque del contenedor
# (Dockerfile). __CSP_HEADER__ vale Content-Security-Policy, o
# Content-Security-Policy-Report-Only para probar una CSP nueva sin bloquear
# nada (CSP_SOLO_REPORTE=true).
#
# Lo que permite la CSP y por qué:
#   script-src  'self'        la build no lleva scripts en línea.
#   style-src   'unsafe-inline' React y Leaflet ponen estilos en el atributo
#                             style; sin esto el mapa sale roto. Más Google
#                             Fonts (la hoja de la fuente).
#   img-src     data: blob:   íconos en línea y la vista previa de la foto
#                             antes de subirla; los mosaicos de OpenStreetMap
#                             y la API, que sirve las fotos firmadas.
#   connect-src la API y Nominatim (dirección del punto elegido en el mapa).
add_header __CSP_HEADER__ "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org __API__; connect-src 'self' __API__ https://nominatim.openstreetmap.org; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
# La app usa el GPS y la cámara (foto de evidencia); nada más.
add_header Permissions-Policy "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()" always;
