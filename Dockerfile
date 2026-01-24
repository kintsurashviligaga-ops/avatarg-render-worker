FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy TypeScript source and config
COPY tsconfig.json ./
COPY worker/ ./worker/

# Build TypeScript
RUN npm install -g typescript && \
    tsc && \
    npm uninstall -g typescript

# Production image
FROM node:20-alpine

# Install FFmpeg and required tools
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu

# Create fonts directory
RUN mkdir -p /app/fonts

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Copy fonts if exists
COPY fonts/ /app/fonts/ 2>/dev/null || true

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

CMD ["node", "dist/render-worker.js"]
