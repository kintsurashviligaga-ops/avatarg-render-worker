FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy TypeScript source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript (adjust rootDir)
RUN npm install -g typescript && \
    tsc && \
    npm uninstall -g typescript

# Production image
FROM node:20-alpine

# Install FFmpeg and tools
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    wget \
    unzip \
    ca-certificates

# Install Georgian fonts
RUN mkdir -p /app/fonts && \
    wget -q -O /tmp/noto.zip https://noto-website-2.storage.googleapis.com/pkgs/NotoSansGeorgian-unhinted.zip && \
    unzip -j /tmp/noto.zip "*.ttf" -d /app/fonts && \
    rm /tmp/noto.zip && \
    fc-cache -f

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

CMD ["node", "dist/render-worker.js"]
