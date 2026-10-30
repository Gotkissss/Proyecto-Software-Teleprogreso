# Frontend en producción (HU-S10-06). El arranque del contenedor reemplaza
# __PORT__ y genera /tmp/nginx/conf.d/default.conf y seguridad.inc (Dockerfile).

# Carpetas temporales: por defecto cuelgan de /var/cache/nginx, que solo
# puede escribir root. El contenedor no corre como root, así que van a
# /tmp igual que la configuración y el pid.
client_body_temp_path /tmp/nginx/body;
proxy_temp_path /tmp/nginx/proxy;
fastcgi_temp_path /tmp/nginx/fastcgi;
uwsgi_temp_path /tmp/nginx/uwsgi;
scgi_temp_path /tmp/nginx/scgi;

server {
    listen __PORT__;
    server_name _;
    server_tokens off;

    root /usr/share/nginx/html;
    index index.html;

    include /tmp/nginx/conf.d/seguridad.inc;

    # Archivos con hash en el nombre: cambian de nombre cuando cambian, así
    # que se pueden guardar un año.
    location /assets/ {
        include /tmp/nginx/conf.d/seguridad.inc;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Lo que decide qué versión de la app corre NO se guarda en caché: con
    # caché, los teléfonos seguían con la PWA vieja hasta recargar a mano
    # (lo que dejó marcas sin ubicación en HU-4).
    location ~ ^/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$ {
        include /tmp/nginx/conf.d/seguridad.inc;
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
