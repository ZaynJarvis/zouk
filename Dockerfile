FROM node:24-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci

COPY . .

RUN cd web && npm run build

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/

RUN npm ci --omit=dev

COPY --from=build /app/web/dist web/dist
COPY server/ server/
COPY schema.sql ./

EXPOSE 7777

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD curl -sf http://localhost:7777/ || exit 1

CMD ["node", "server/index.js"]
