# La API de ConstruSoft, para el despliegue de prueba en Dokploy (bitácora del
# producto, 21 de octubre de 2026). El contexto es la raíz del repositorio.
#
# Corre el TypeScript con tsx, igual que en el PC del dueño: no hay paso de
# compilación, y lo que la API lee del disco con rutas relativas a su propio
# archivo (legal/<versión>/legal.html y src/exportacion/fuentes/*.ttf) queda
# donde lo busca.
#
# Una sola réplica: el contador de intentos fallidos vive en la memoria del
# proceso (04 §8.6), y la purga diaria corre aquí adentro.
#
# Las variables las pone Dokploy en el entorno: no hay .env en la imagen, y por
# eso el arranque es «node» directo y no «npm run api», que lee --env-file=.env.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Primero las dependencias: la capa se reutiliza mientras el lockfile no cambie.
# Debian (glibc) y no Alpine: el binario de Argon2 del lockfile es el de glibc.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY legal ./legal
COPY src ./src
# Las pruebas no van a la imagen. src/pruebas sí: el guion de demostración la usa.
RUN find src -name '*.test.ts' -delete

# 0.0.0.0 para que Traefik la alcance dentro de la red de Docker.
ENV HOST=0.0.0.0 PUERTO=3000
EXPOSE 3000
USER node
CMD ["node", "--import", "tsx", "src/http/arrancar.ts"]
