/**
 * Shared building blocks for the package `rstest.config.ts`.
 *
 * Local to this repository rather than shared from the Midscene monorepo: this
 * project consumes Midscene from npm, so it must not depend on files that only
 * exist in that repository's working tree.
 */

/**
 * Externalize the photon native addon. Rspack cannot bundle its prebuilt
 * binary, so the node-target test config marks it as a CommonJS external.
 */
export const photonExternal = {
  '@silvia-odwyer/photon': 'commonjs @silvia-odwyer/photon',
} as const;

/**
 * Build the `source.define` entry that injects a package version as the
 * `__VERSION__` global.
 */
export function defineVersion(version: string): { __VERSION__: string } {
  return { __VERSION__: JSON.stringify(version) };
}
