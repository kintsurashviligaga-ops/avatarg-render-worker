FROM node:20-bullseye

# ===============================
# System deps (fonts, ffmpeg-ready)
# ===============================
RUN apt-get update && \
    apt-get install -y \
          fontconfig \
                fonts-dejavu-core \
                    && rm -rf /var/lib/apt/lists/*

                    # ===============================
                    # App setup
                    # ===============================
                    WORKDIR /app

                    # Copy package files FIRST (important for ESM)
                    COPY package.json package-lock.json* ./
                    RUN npm install

                    # Copy rest of the app
                    COPY . .

                    # Font cache (optional, safe)
                    RUN fc-cache -f || true

                    ENV NODE_ENV=production

                    CMD ["npm", "run", "start"]