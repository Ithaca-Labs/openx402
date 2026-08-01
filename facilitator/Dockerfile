FROM node:24-bookworm-slim AS sdk-build
WORKDIR /sdk
COPY packages/bazaar-sdk/package.json packages/bazaar-sdk/package-lock.json ./
RUN npm ci
COPY packages/bazaar-sdk/tsconfig.json ./
COPY packages/bazaar-sdk/src ./src
RUN npm run build

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY facilitator/package.json facilitator/package-lock.json ./
COPY --from=sdk-build /sdk/package.json /packages/bazaar-sdk/package.json
COPY --from=sdk-build /sdk/dist /packages/bazaar-sdk/dist
COPY packages/bazaar-sdk/README.md packages/bazaar-sdk/LICENSE /packages/bazaar-sdk/
RUN npm ci
COPY facilitator/tsconfig.json ./
COPY facilitator/src ./src
RUN npm run build:service

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY facilitator/package.json facilitator/package-lock.json ./
COPY --from=sdk-build /sdk/package.json /packages/bazaar-sdk/package.json
COPY --from=sdk-build /sdk/dist /packages/bazaar-sdk/dist
COPY packages/bazaar-sdk/README.md packages/bazaar-sdk/LICENSE /packages/bazaar-sdk/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY facilitator/migrations ./migrations
COPY facilitator/config ./config
USER node
EXPOSE 4022
CMD ["node", "dist/src/server.js"]
