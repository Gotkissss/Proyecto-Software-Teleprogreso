# ============================================================
# Frontend — React + Vite — Multi-stage (dev + producción)
# ============================================================

# ---------- Etapa: Development (para docker-compose local) ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS development

WORKDIR /app

# SCRUM-182: `npm ci` y no `npm install`, igual que la etapa de build y que el
# CI. `npm install` resuelve por su cuenta cuando package.json y el lockfile no
# coinciden, así que el contenedor podía levantar con una versión de leaflet
# distinta de la que se probó, y el desajuste solo aparecía en producción.
# `npm ci` instala exactamente el lockfile y falla si está desincronizado.
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 80
EXPOSE 5173

# Vite dev server en el puerto 80 (porque docker-compose mapea 5173:80)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]


# ---------- Etapa: Build (para producción) ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---------- Etapa: Producción (Nginx en Railway) ----------
FROM nginx:stable-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951 AS production

COPY --from=builder /app/dist /usr/share/nginx/html

# Configuración en frontend/nginx/ (HU-S10-06): cabeceras de seguridad y
# caché. Son plantillas porque el puerto y el origen de la API se conocen al
# arrancar, no al construir.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.tpl nginx/seguridad.conf.tpl /etc/nginx/plantillas/

# Sin root (HU-S10-06): el proceso maestro de nginx también corre como el
# usuario `nginx`, el pid va a /tmp y el puerto por defecto es uno que no
# exige privilegios (Railway pone el suyo en $PORT).
#
# Lo que el arranque escribe vive bajo /tmp, no bajo /etc. La versión
# anterior le daba la carpeta de configuración al usuario `nginx` con un
# `chown`, y eso solo sirve si el contenedor corre con ESE usuario: Railway
# lo arranca con otro, así que moría en "can't create
# /etc/nginx/conf.d/default.conf: Permission denied" y el sitio pasó cuatro
# días devolviendo 502, tapado por la caché de la PWA. /tmp lo escribe
# cualquier usuario, así que arranca corra con el uid que corra.
RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
    && sed -i 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
    && sed -i 's#include /etc/nginx/conf.d/[*].conf;#include /tmp/nginx/conf.d/*.conf;#' /etc/nginx/nginx.conf \
    && grep -q '/tmp/nginx/conf.d' /etc/nginx/nginx.conf
USER nginx

ENV PORT=8080
EXPOSE 8080

# __API__: el origen de la API que la CSP deja llamar y del que deja cargar
# fotos. Es la misma VITE_API_URL de la build (en Railway la variable existe al
# construir y al correr); sin ella, el backend de Railway, igual que el
# respaldo de api/client.js.
CMD ["sh", "-c", "echo \"nginx arranca como $(id)\"; mkdir -p /tmp/nginx/conf.d; API=${VITE_API_URL:-https://backend-production-6d60.up.railway.app}; API=${API%/}; CABECERA=Content-Security-Policy; [ \"$CSP_SOLO_REPORTE\" = true ] && CABECERA=Content-Security-Policy-Report-Only; sed \"s/__PORT__/$PORT/g\" /etc/nginx/plantillas/default.conf.tpl > /tmp/nginx/conf.d/default.conf && sed -e \"s#__API__#$API#g\" -e \"s#__CSP_HEADER__#$CABECERA#g\" /etc/nginx/plantillas/seguridad.conf.tpl > /tmp/nginx/conf.d/seguridad.inc && exec nginx -g 'daemon off;'"]
