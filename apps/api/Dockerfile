# Build context is the REPO ROOT (see fly.toml dockerfile path).
# The API runs TypeScript directly via tsx — no compile step needed for the
# prototype, which keeps the week-1 pipeline simple.
FROM node:22-slim

WORKDIR /app

# Install workspace deps using only the manifests, so this layer is cached
# until a package.json actually changes.
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm install --omit=dev --workspaces --include-workspace-root

# App source.
COPY tsconfig.base.json ./
COPY packages/types ./packages/types
COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@leksis/api"]
