FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
RUN mkdir -p /app/data/files && chown -R node:node /app/data
USER node
EXPOSE 3100
CMD ["node", "--import", "tsx", "scripts/start.ts"]
