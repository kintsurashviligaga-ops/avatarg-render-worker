იპოვე:FROM node:20-alpine AS 
builder RUN mkdir -p /app/fonts 
WORKDIR /app შეცვალე: RUN apk add 
--no-cache \# Install dependencies 
COPY package*.json ./ RUN npm ci 
--only=production
    ffmpeg \ fontconfig \# Copy 
    TypeScript config and source 
    ttf-dejavu \COPY tsconfig.json 
    ./ wget \COPY worker/ 
    ./worker/ ca-certificates
# Build TypeScript Download 
# Georgian font from Google Fonts 
# CDNRUN npm install -g typescript 
# && \
RUN mkdir -p /app/fonts && \ tsc 
    && \ npm uninstall -g 
    typescript wget -O 
    /app/fonts/NotoSansGeorgian-Regular.ttf 
    \ 
    "https://github.com/notofonts/georgian/raw/main/fonts/NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Regular.ttf" 
    && \# Production image 
    fc-cache -fFROM node:20-alpine
Save: Ctrl+O → Enter → Ctrl+X
# Install FFmpeg and tools
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

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

CMD ["node", "dist/render-worker.js"]
