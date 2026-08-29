FROM node:20-slim

ENV NODE_ENV=production PORT=3000

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 3000

USER node

CMD ["node", "src/index.js"]
