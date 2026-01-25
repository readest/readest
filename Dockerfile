FROM node:22-slim

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PATH}:${PNPM_HOME}"

RUN npm install --global pnpm

COPY . /app

WORKDIR /app

RUN pnpm install

RUN pnpm --filter @readest/readest-app setup-vendors

WORKDIR /app/apps/readest-app

RUN pnpm build-web

ENTRYPOINT ["pnpm", "start-web"]
