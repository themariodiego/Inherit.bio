FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
