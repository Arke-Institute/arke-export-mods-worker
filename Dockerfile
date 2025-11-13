# Multi-stage Dockerfile for MODS export worker
# Optimized for small image size and fast builds

# ============================================================================
# Stage 1: Build TypeScript
# ============================================================================
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json tsconfig.json ./
RUN npm install

# Copy source code
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

# ============================================================================
# Stage 2: Production Runtime
# ============================================================================
FROM node:20-slim

WORKDIR /app

# Install production dependencies only (no devDependencies)
COPY package.json ./
RUN npm install --production

# Copy built JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Run as non-root user for security
USER node

# Start worker immediately (runs on container start)
CMD ["node", "dist/index.js"]
