FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json models.lock.json ./
RUN npm ci

COPY bin ./bin
COPY scripts ./scripts
COPY src ./src
COPY LICENSE README.md ./
RUN npm run build \
  && node dist/bin/sverklo.js setup \
  && npm prune --omit=dev

FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=build /app /app
COPY --from=build /root/.sverklo /root/.sverklo

ENTRYPOINT ["node", "/app/dist/bin/sverklo.js", "/workspace"]
