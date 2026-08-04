# syntax=docker/dockerfile:1

FROM node:23-slim AS base

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

RUN npm install -g pnpm bun

COPY package.json pnpm-lock.yaml ./
# Skip lifecycle scripts so optional deps (plugin-ollama postinstall) cannot fail the build.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild esbuild bcrypt 2>/dev/null || true

COPY . .

RUN pnpm build

RUN mkdir -p /app/data && chown -R node:node /app

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000

USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3000)+'/aperture/api/steward/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
