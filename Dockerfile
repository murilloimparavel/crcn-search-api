FROM node:20-slim

# Instalar dependências necessárias para o Chromium rodar no Linux
RUN apt-get update && apt-get install -y     chromium     fonts-ipafont-gothic     fonts-wqy-zenhei     fonts-thai-tlwg     fonts-kacst     fonts-freefont-ttf     libxss1     dumb-init     --no-install-recommends     && apt-get clean

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true     PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium     NODE_ENV=production     PORT=3000

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 3000

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]
