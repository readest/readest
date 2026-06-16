FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/readest-app/package.json ./apps/readest-app/
COPY patches/ ./patches/
COPY packages/ ./packages/
RUN --mount=type=cache,id=pnpm,sharing=locked,target=/pnpm/store pnpm install --frozen-lockfile
RUN test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    || { printf '\nERROR: Required git submodules are not initialized in the source directory.\nEnsure submodules are initialized before running docker build.\nRun: git submodule update --init packages/foliate-js packages/simplecc-wasm\n\n'; exit 1; }
RUN pnpm --filter @readest/readest-app setup-vendors

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS development-stage
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
COPY --from=dependencies /app /app
COPY . .
WORKDIR /app/apps/readest-app
EXPOSE 3000
ENTRYPOINT ["pnpm", "dev-web", "-H", "0.0.0.0"]

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_PLATFORM
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_OBJECT_STORAGE_TYPE
ARG NEXT_PUBLIC_STORAGE_FIXED_QUOTA
ARG NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/apps/readest-app/node_modules /app/apps/readest-app/node_modules
COPY --from=dependencies /app/apps/readest-app/public/vendor /app/apps/readest-app/public/vendor
COPY --from=dependencies /app/packages/foliate-js/node_modules /app/packages/foliate-js/node_modules
COPY . .
WORKDIR /app/apps/readest-app
# Opt into the self-contained `.next/standalone` tree for this image only;
# next.config.mjs gates `output: 'standalone'` on BUILD_STANDALONE so other
# web builds keep their default output.
ENV BUILD_STANDALONE=true
RUN pnpm build-web

# Production runtime ships only the standalone server, its traced node_modules,
# and the static/public assets — no pnpm, no source tree, no dev dependencies,
# no build cache. `output: 'standalone'` (next.config.mjs) emits the self-contained
# tree under .next/standalone, so the entrypoint is a plain `node server.js`.
FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS production-stage
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# Monorepo-rooted standalone tree: server.js + hoisted, traced node_modules.
COPY --from=build --chown=node:node /app/apps/readest-app/.next/standalone ./
# Static and public assets are not part of the standalone trace; copy them next
# to the server so their default relative paths resolve.
COPY --from=build --chown=node:node /app/apps/readest-app/.next/static ./apps/readest-app/.next/static
COPY --from=build --chown=node:node /app/apps/readest-app/public ./apps/readest-app/public
USER node
EXPOSE 3000
ENTRYPOINT ["node", "apps/readest-app/server.js"]
