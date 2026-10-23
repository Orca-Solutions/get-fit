/** Keep the supported Node 22 line above the October 2026 security release. */
export function assertPatchedNode(version = process.version): void {
  const match = /^v22\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version);
  const minor = match ? Number(match[1]) : NaN;
  const patch = match ? Number(match[2]) : NaN;
  if (!Number.isSafeInteger(minor) || !Number.isSafeInteger(patch) || minor < 23 || (minor === 23 && patch < 4)) {
    throw new Error('get-fit requires Node.js 22.23.4 or a later stable release in the 22.x line.');
  }
}
