# Build from the repo root: docker build -f cdn/Dockerfile -t hls-bundles .
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx rollup --config --configType coreMin

FROM node:22-slim
WORKDIR /app
ENV PORT=8080 CACHE_DIR=/cache
COPY --from=build /src/node_modules/esbuild node_modules/esbuild
COPY --from=build /src/node_modules/@esbuild node_modules/@esbuild
COPY --from=build /src/dist/core.min dist/core.min
COPY scripts/bundle-features.js scripts/
COPY cdn/server.js cdn/
RUN mkdir /cache && chown node /cache
USER node
VOLUME /cache
EXPOSE 8080
CMD ["node", "cdn/server.js"]
