# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build

WORKDIR /app

# Web rewrite target is resolved during next build via next.config.ts
ARG API_URL="http://localhost:3001"
ENV API_URL="${API_URL}"

COPY . .

RUN npm ci

# Ensure Prisma client is generated for the Linux image
RUN npm -w packages/database run db:generate

# Build all workspaces (api/worker/web/…)
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

# Default to API; docker-compose overrides per-service
CMD ["npm", "-w", "packages/api", "run", "start"]
