import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const productionStage = dockerfile.slice(dockerfile.indexOf('AS production-stage'));
const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps/readest-app/package.json'), 'utf8'),
) as { scripts: Record<string, string> };

describe('Docker image runtime defaults', () => {
  /**
   * The published image is the self-hosted artifact — web.readest.com runs on
   * Cloudflare/Vercel, never on this image — so it defaults `SELF_HOSTED` on
   * itself instead of relying on the operator's compose file. `compose.yaml`
   * passes `SELF_HOSTED: ${SELF_HOSTED:-true}`, but that line only landed in
   * #5996: a compose file copied before it stays on disk through every
   * `docker compose pull`, so the container came up gated with no way for the
   * operator to know why (#6093). An operator selling plans still overrides it
   * with `SELF_HOSTED=false`.
   */
  test('unlocks premium features without an operator-supplied env var', () => {
    expect(productionStage).toMatch(/^ENV SELF_HOSTED=true$/m);
  });
});

describe('Docker build stage vendor assets', () => {
  /**
   * `setup-vendors` runs in the `dependencies` stage, and `.dockerignore`
   * keeps its output out of the build context, so every directory it creates
   * needs an explicit `COPY --from=dependencies`. `vendor/` (the pdf.js and
   * simplecc modules the bundler imports through the @pdfjs / @simplecc
   * aliases) was missed when it was split out of `public/vendor`, and
   * `pnpm build-web` failed with "Can't resolve '@pdfjs/pdf.min.mjs'" (#6368).
   */
  test('copies every vendor root that setup-vendors creates', () => {
    // `prepare-vendor` is the source of truth: "mkdirp ./public/vendor/pdfjs ./vendor/..."
    const roots = new Set(
      [...pkg.scripts['prepare-vendor']!.matchAll(/\.\/(\S+)/g)].map((m) =>
        // keep the first two segments: public/vendor/pdfjs -> public/vendor
        m[1]!
          .split('/')
          .slice(0, m[1]!.startsWith('public/') ? 2 : 1)
          .join('/'),
      ),
    );
    expect(roots.size).toBeGreaterThan(1);

    for (const root of roots) {
      expect(dockerfile).toContain(
        `COPY --from=dependencies /app/apps/readest-app/${root} /app/apps/readest-app/${root}`,
      );
    }
  });
});
