// @vitest-environment node
// blog-lib resolves __dirname from import.meta.url, which jsdom does not provide as a file URL.

import { describe, it, expect, afterEach } from 'vitest';

import { applianceBlockReason } from '../scripts/blog-lib.mjs';

const originalAllow = process.env.ALLOW_PUBLISH;

afterEach(() => {
  if (originalAllow === undefined) delete process.env.ALLOW_PUBLISH;
  else process.env.ALLOW_PUBLISH = originalAllow;
});

describe('applianceBlockReason', () => {
  it('blocks the Mini, which mirrors the site but never commits', () => {
    const reason = applianceBlockReason('mediaserver');
    expect(reason).toMatch(/Refusing to publish/);
    expect(reason).toMatch(/localhost:4322/);
  });

  it('ignores the .local suffix and case', () => {
    expect(applianceBlockReason('MediaServer.local')).not.toBeNull();
  });

  it('allows the workshop machine', () => {
    expect(applianceBlockReason('Irwins-MacBook-Pro.local')).toBeNull();
  });

  it('allows any host that is not an appliance', () => {
    expect(applianceBlockReason('some-other-mac')).toBeNull();
  });

  it('honours ALLOW_PUBLISH=1 as a deliberate override', () => {
    process.env.ALLOW_PUBLISH = '1';
    expect(applianceBlockReason('mediaserver')).toBeNull();
  });
});
