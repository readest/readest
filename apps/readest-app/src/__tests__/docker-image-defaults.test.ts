import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const productionStage = dockerfile.slice(dockerfile.indexOf('AS production-stage'));

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
