FROM node:20-bullseye

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy app
COPY . .

ENV NODE_ENV=production

# Worker-only app: no HTTP port, no EXPOSE
CMD ["npm", "run", "worker"]