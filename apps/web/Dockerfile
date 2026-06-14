# Build context is the REPO ROOT (see fly.toml dockerfile path).
# Stage 1: build the static SPA. Stage 2: serve it with nginx.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm install --workspaces --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/types ./packages/types
COPY apps/web ./apps/web
RUN npm run build --workspace @leksis/web

FROM nginx:1.27-alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
