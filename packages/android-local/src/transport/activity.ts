/**
 * Building and parsing the commands that launch an Android app.
 *
 * Shared by both transports: they used to build the launch command
 * independently, which is how the same defect ended up in both.
 */
import { quoteShellArg } from './command-runner';

/**
 * Parsing for `cmd package resolve-activity --brief <pkg>`.
 *
 * The command prints a metadata line and then the component, so the component
 * is the last non-empty line:
 *
 * ```text
 * priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
 * com.android.settings/.Settings
 * ```
 *
 * A package with no launcher activity prints `No activity found` (and still
 * exits 0), so a miss has to be recognised by shape rather than by exit code.
 */
export function parseResolvedActivity(stdout: string): string | undefined {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  // A component is `package/activity`, with no whitespace anywhere.
  if (!last?.includes('/') || /\s/.test(last)) {
    return undefined;
  }
  return last;
}

/**
 * Ask the package manager which activity a package launches.
 *
 * The `LAUNCHER` category is explicit because that is the question being asked:
 * "what does tapping this app's icon start". Without it the resolver can answer
 * with the package's default activity instead, which is not always the same
 * thing.
 */
export function resolveActivityCommand(packageName: string): string {
  return `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${quoteShellArg(packageName)}`;
}

/** Start an explicit component and wait for it. */
export function startActivityCommand(component: string): string {
  return `am start -W -n ${quoteShellArg(component)}`;
}
