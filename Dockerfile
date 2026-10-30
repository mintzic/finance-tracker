FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/app/data/finance.sqlite RECEIPT_DIR=/app/data/receipts
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json package-lock.json ./
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
