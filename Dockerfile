FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY tsconfig.json ./
COPY worker/ ./worker/

RUN npm install -g typescript && \
    tsc && \
    npm uninstall -g typescript

FROM node:20-alpine

RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    wget \
    ca-certificates

RUN mkdir -p /app/fonts && \
    wget -O /app/fonts/NotoSansGeorgian-Regular.ttf \
    "https://github.com/notofonts/georgian/raw/main/fonts/NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Regular.ttf" && \
    fc-cache -f

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

CMD ["node", "dist/render-worker.js"]
