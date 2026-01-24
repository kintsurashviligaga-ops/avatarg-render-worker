FROM node:20-slim

# --------------------
# System dependencies
# --------------------
RUN apt-get update \
  && apt-get install -y ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

    # --------------------
    # App setup
    # --------------------
    WORKDIR /app

    # Install deps first (better cache)
    COPY package.json package-lock.json ./
    RUN npm ci --omit=dev

    # Copy app source
    COPY . .

    # --------------------
    # Environment
    # --------------------
    ENV NODE_ENV=production
    ENV FFMPEG_BIN=ffmpeg

    # --------------------
    # Start EXACT worker
    # --------------------
    CMD ["node", "src/worker.js"]