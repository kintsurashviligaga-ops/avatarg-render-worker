FROM node:20-bullseye

# --- system deps (ffmpeg აუცილებელია) ---
RUN apt-get update && \
    apt-get install -y ffmpeg ca-certificates && \
        rm -rf /var/lib/apt/lists/*

        # --- app dir ---
        WORKDIR /app

        # --- deps ---
        COPY package.json package-lock.json ./
        RUN npm ci --omit=dev

        # --- app code ---
        COPY . .

        # --- env ---
        ENV NODE_ENV=production
        ENV FONT_DIR=/app/fonts
        ENV FFMPEG_BIN=ffmpeg

        # --- sanity check (optional but useful) ---
        RUN ffmpeg -version

        # --- run worker directly (ყველაზე სტაბილური Fly-ზე) ---
        CMD ["node", "src/worker.js"]