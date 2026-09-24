# FrameOS daemon with Linux-native Google Cloud CLI for ADC token minting.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config libmlt++-dev libmlt-dev \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/daemon/package.json apps/daemon/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/sdk-typescript/package.json packages/sdk-typescript/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY . .
RUN GOMAXPROCS=2 npm run build --workspace @frameos/contracts && GOMAXPROCS=2 npm run build --workspace @frameos/daemon
RUN cmake -S native/engine-worker -B /tmp/engine-worker -DFRAMEOS_WITH_MLT=ON \
  && cmake --build /tmp/engine-worker --config Release \
  && /tmp/engine-worker/frameos-engine-worker capabilities | grep -q '\"id\":\"engine.mlt\".*\"available\":true'

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/google-cloud.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/google-cloud.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-cloud-cli libmlt++7 libmlt7 libmlt-data ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/daemon/assets ./apps/daemon/assets
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/daemon/package.json ./apps/daemon/package.json
COPY --from=build /app/apps/daemon/dist ./apps/daemon/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
RUN mkdir -p /app/bin
COPY --from=build /tmp/engine-worker/frameos-engine-worker /app/bin/frameos-engine-worker
ENV NODE_ENV=production
ENV FRAMEOS_HOST=0.0.0.0
ENV FRAMEOS_DATA_DIR=/app/.frameos-data
ENV FRAMEOS_GCLOUD_COMMAND=gcloud
ENV FRAMEOS_ENGINE_WORKER=/app/bin/frameos-engine-worker
ENV CLOUDSDK_CONFIG=/gcloud
EXPOSE 31415
CMD ["node", "apps/daemon/dist/index.js"]
