# La parte web de ConstruSoft: se compila con Node y se sirve con nginx.
#
# El contexto de construcción es la RAÍZ del repositorio, no web/: la pantalla
# usa el formateador de cifras de la API (src/comun/formatoNumerico.ts) para
# que un número se vea igual en la pantalla, el PDF y el Excel.
#
# En Dokploy: tipo de construcción Dockerfile, «Dockerfile Path» web/Dockerfile,
# «Docker Context Path» un punto (.), y el dominio al puerto 80.

FROM node:22-alpine AS construir
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY src/comun/formatoNumerico.ts /repo/src/comun/formatoNumerico.ts
RUN npm run build

FROM nginx:1.28-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=construir /repo/web/dist /usr/share/nginx/html
EXPOSE 80
