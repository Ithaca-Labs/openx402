FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Workspace manifests must exist before `npm ci` can resolve the lockfile.
COPY packages/bazaar-sdk/package.json ./packages/bazaar-sdk/
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY packages ./packages
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/bazaar-sdk/package.json ./packages/bazaar-sdk/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/bazaar-sdk/dist ./packages/bazaar-sdk/dist
COPY migrations ./migrations
COPY config ./config
USER node
EXPOSE 4022
CMD ["node", "dist/src/server.js"]
