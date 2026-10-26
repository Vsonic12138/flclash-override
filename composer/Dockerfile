FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com

COPY server.js override.js ./

ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=13200 \
    SECRET=/dgc \
    CACHE_TTL=300 \
    LAST_GOOD_DIR=/app/data

VOLUME ["/app/data"]

EXPOSE 13200

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:13200/health || exit 1

CMD ["node", "server.js"]
