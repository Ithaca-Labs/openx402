FROM node:24-bookworm-slim AS sdk-build
WORKDIR /sdk
COPY packages/bazaar-sdk/package.json packages/bazaar-sdk/package-lock.json ./
RUN npm ci
COPY packages/bazaar-sdk/tsconfig.json ./
COPY packages/bazaar-sdk/src ./src
RUN npm run build

FROM node:24-bookworm-slim AS upto-client-build
WORKDIR /sdk
COPY packages/stellar-upto/package.json packages/stellar-upto/package-lock.json ./
COPY packages/stellar-upto/tsconfig.json ./
COPY packages/stellar-upto/src ./src
COPY packages/stellar-upto/test ./test
RUN npm ci && npm run build

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY facilitator/package.json facilitator/package-lock.json ./
COPY --from=sdk-build /sdk/package.json /packages/bazaar-sdk/package.json
COPY --from=sdk-build /sdk/dist /packages/bazaar-sdk/dist
COPY packages/bazaar-sdk/README.md packages/bazaar-sdk/LICENSE /packages/bazaar-sdk/
COPY --from=upto-client-build /sdk/package.json /packages/stellar-upto/package.json
COPY --from=upto-client-build /sdk/dist /packages/stellar-upto/dist
COPY packages/stellar-upto/README.md packages/stellar-upto/LICENSE /packages/stellar-upto/
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
COPY --from=upto-client-build /sdk/package.json /packages/stellar-upto/package.json
COPY --from=upto-client-build /sdk/dist /packages/stellar-upto/dist
COPY packages/stellar-upto/README.md packages/stellar-upto/LICENSE /packages/stellar-upto/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY facilitator/migrations ./migrations
COPY facilitator/config ./config
USER node
EXPOSE 4022
CMD ["node", "dist/src/server.js"]
