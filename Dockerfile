FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22.23.4-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY server/builder ./server/builder
COPY server/agent-skills ./server/agent-skills
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 5001
CMD ["node","server/dist/index.js"]
