# syntax=docker/dockerfile:1

FROM node:23-slim AS base

# Install system dependencies needed for native modules (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

# Disable telemetry
ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

# Install pnpm and Bun (ElizaOS CLI uses Bun to run project builds)
RUN npm install -g pnpm bun

# Copy package manifest and install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy all source files
COPY . .

# Compile TypeScript (dist/ is not copied from the host context)
RUN pnpm build

# Create data directory for SQLite + steward artifacts
RUN mkdir -p /app/data && chown -R node:node /app

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000

USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3000)+'/aperture/api/steward/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
