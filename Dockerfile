# Multi-stage production build for Codebase Explainer AI
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy workspace configurations
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

# Build shared types, frontend UI bundle, and backend TypeScript
RUN pnpm --filter @codebase-explainer/shared build
RUN pnpm --filter @codebase-explainer/frontend build
RUN pnpm --filter @codebase-explainer/backend build

# Production Runner
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml* /app/pnpm-workspace.yaml* ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules

EXPOSE 3001
ENV PORT=3001
ENV HOST=0.0.0.0

CMD ["node", "backend/dist/index.js"]
