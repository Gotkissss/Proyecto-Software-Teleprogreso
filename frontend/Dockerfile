# ============================================================
# Frontend — React + Vite — Multi-stage (dev + producción)
# ============================================================

# ---------- Etapa: Development (para docker-compose local) ----------
FROM node:20-alpine AS development

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
FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---------- Etapa: Producción (Nginx en Railway) ----------
FROM nginx:stable-alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html

RUN rm /etc/nginx/conf.d/default.conf

RUN cat > /etc/nginx/conf.d/default.conf.tpl << 'EOF'
server {
    listen __PORT__;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
EOF

ENV PORT=80
EXPOSE 80

CMD sh -c "sed \"s/__PORT__/$PORT/g\" /etc/nginx/conf.d/default.conf.tpl > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"