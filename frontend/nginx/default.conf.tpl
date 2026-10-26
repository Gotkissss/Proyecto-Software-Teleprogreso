# Frontend en producción (HU-S10-06). El arranque del contenedor reemplaza
# __PORT__ y genera conf.d/default.conf y conf.d/seguridad.inc (Dockerfile).
server {
    listen __PORT__;
    server_name _;
    server_tokens off;

    root /usr/share/nginx/html;
    index index.html;

    include /etc/nginx/conf.d/seguridad.inc;

    # Archivos con hash en el nombre: cambian de nombre cuando cambian, así
    # que se pueden guardar un año.
    location /assets/ {
        include /etc/nginx/conf.d/seguridad.inc;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Lo que decide qué versión de la app corre NO se guarda en caché: con
    # caché, los teléfonos seguían con la PWA vieja hasta recargar a mano
    # (lo que dejó marcas sin ubicación en HU-4).
    location ~ ^/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$ {
        include /etc/nginx/conf.d/seguridad.inc;
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
