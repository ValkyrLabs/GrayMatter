FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json index.js ./

USER node
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3333}/health" || exit 1

CMD ["node", "index.js"]

