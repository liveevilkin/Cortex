# ── Build stage ──
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
RUN npx tsc

# ── Production stage ──
FROM node:22-alpine

WORKDIR /app

# Copy compiled JS and production deps
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./
COPY entity-dictionary.json ./

# Create data directory
RUN mkdir -p /app/data

# MCP stdio transport — no port needed
EXPOSE 0

ENV NODE_ENV=production
ENV MCP_MEMORY_LOG_LEVEL=warn

# Default vault paths (override at runtime)
ENV CLAUDE_CODE_MEMORY_VAULT=/vault/memory
ENV MCP_MEMORY_ADDITIONAL_VAULTS=/vault/knowledge
ENV MCP_MEMORY_DB_DIR=/app/data

ENTRYPOINT ["node", "dist/index.js"]
