import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

/**
 * Type-check as part of the build.
 *
 * Local to this repository rather than shared from the Midscene monorepo: this
 * project consumes Midscene from npm, so it must not depend on files that only
 * exist in that repository's working tree.
 */
export const createTypeCheckPlugin = () =>
  pluginTypeCheck({
    tsCheckerOptions: {
      typescript: {
        // Keep type checking scoped to the current project instead of letting
        // TypeScript build mode follow the project references graph.
        build: false,
      },
    },
  });
