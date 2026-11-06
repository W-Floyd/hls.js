# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f cdn/Dockerfile -t hls-bundles .
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Cache mount keeps downloaded packages across builds when the lockfile changes.
# Fully offline first: with network allowed, npm still makes requests even when
# everything is cached, and Docker Desktop's network made that take ~5 min vs
# ~5 s offline. Falls back to the network only when a package isn't cached yet.
RUN --mount=type=cache,target=/root/.npm \
  npm ci --ignore-scripts --offline --no-audit --no-fund \
  || npm ci --ignore-scripts --prefer-offline --no-audit --no-fund
COPY . .
RUN npx rollup --config --configType core --configType coreNoLogs --configType autoEsm --configType autoUmd \
  && rm -rf node_modules/@swc/core-linux-*-musl

FROM node:22-slim
WORKDIR /app
ENV PORT=8080 CACHE_DIR=/cache
# Only the bundler's runtime dependencies, with their glibc binaries: swc's
# musl build (Alpine) was 5-8x slower.
COPY --from=build /src/node_modules/esbuild node_modules/esbuild
COPY --from=build /src/node_modules/@esbuild node_modules/@esbuild
COPY --from=build /src/node_modules/@swc node_modules/@swc
COPY --from=build --exclude=*.map /src/dist/core dist/core
COPY --from=build --exclude=*.map /src/dist/core-nolog dist/core-nolog
COPY --from=build /src/dist/hls.auto.min.mjs /src/dist/hls.auto.min.js dist/
COPY src/features/codes.json src/features/presets.json src/features/
COPY scripts/bundle-features.js scripts/
COPY cdn/server.js cdn/
RUN mkdir /cache && chown node /cache
USER node
VOLUME /cache
EXPOSE 8080
CMD ["node", "cdn/server.js"]
