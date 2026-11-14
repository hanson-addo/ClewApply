# Local development only: the Vite dev server with the source mounted from your checkout.
FROM node:22-bookworm-slim

WORKDIR /app/apps/web
# Dependencies only, so this layer is reused until package-lock.json changes.
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
