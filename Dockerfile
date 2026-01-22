FROM node:20-bullseye

RUN apt-get update && \
    apt-get install -y ffmpeg fontconfig && \
        rm -rf /var/lib/apt/lists/*

        WORKDIR /app

        COPY package.json package-lock.json* ./
        RUN npm install --omit=dev

        COPY fonts/NotoSansGeorgian-Regular.ttf /usr/share/fonts/truetype/NotoSansGeorgian-Regular.ttf
        RUN fc-cache -f -v

        COPY src ./src

        ENV NODE_ENV=production
        EXPOSE 8080

        CMD ["npm","run","start"]