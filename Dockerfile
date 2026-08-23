# ==========================================
# Multi-Stage Dockerfile (Test, Dev, Prod)
# ==========================================

# 1. Base Image
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl

# 2. Dependencies
FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# 3. Test Runner Stage
FROM dependencies AS test
COPY tsconfig.json ./
COPY nodemon.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
ENV NODE_ENV=test
ENV DB_HOST=postgres-test
ENV DB_PORT=5432
ENV DB_USER=postgres
ENV DB_PASSWORD=postgres
ENV DB_NAME=fastify_db_test
ENV DB_SYNC=true
RUN npm run typecheck
CMD ["npm", "test"]

# 4. Builder Stage
FROM dependencies AS builder
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# 5. Production Runtime
FROM base AS production
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
