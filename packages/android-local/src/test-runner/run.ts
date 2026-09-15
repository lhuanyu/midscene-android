/**
 * Run a `@midscene/test` YAML project against the device this process is
 * already on.
 *
 * **Why this is not the `midscene-test` CLI.** The CLI is the upstream entry
 * point, and going through it would be less code. It cannot run here: it loads
 * its project config with `tsx`, and `tsx` needs esbuild's platform binary.
 * Android 10+ refuses to execute a binary from an app's writable data
 * directory, which is the same constraint that makes this project ship Node and
 * adb as `jniLibs` `.so` files rather than as executables. Shipping a second
 * native binary to work around that is not worth it, so this module drives the
 * engine directly.
 *
 * The engine and the report mapper are upstream's: `collectWorkflowDocument`
 * and `runWorkflowDocument` do the parsing and execution, and
 * `buildTestRunReportDump` turns the result into the same unified HTML report
 * the CLI produces. Only the parts the CLI gets from a config file — which
 * nodes exist, and how a run is persisted — live here, and on a phone those
 * are the app's decisions rather than the user's.
 */
import fs from 'node:fs';
import path from 'node:path';

import { TestRunReportAssembler } from '@midscene/core/report';
import {
  type CaseRunOutcome,
  type NodeDefinition,
  NodeRegistry,
  type WorkflowDocumentRunResult,
  buildTestRunReportDump,
  collectTestRunReportSources,
  collectWorkflowDocument,
  runWorkflowDocument,
} from '@midscene/test';
import { createMidsceneNodes } from '@midscene/test/midscene';

import { getDebug } from '@midscene/shared/logger';

import { OnDeviceAndroidAgent } from './agent';
import { runAdbShellNode } from './nodes';

const debugTestRunner = getDebug('android-local:test-runner');

/** One document is one YAML file; the CLI calls the same thing a source. */
export interface CollectedSource {
  absolutePath: string;
  sourcePath: string;
}

export interface RunAndroidTestProjectOptions {
  /** Directory holding the YAML cases. */
  projectRoot: string /** Where the unified HTML report is written. */;
  reportDir: string;
  /** Where per-run results (summary.json) are written. */
  resultDir: string;
  /**
   * Builds the agent for one case attempt.
   *
   * **One agent per case, not one per run.** The unified report refuses to
   * share a single agent report between two test scopes, and a scope is a case
   * attempt — so a run-wide agent makes assembly fail outright as soon as a
   * project has more than one case. Each agent writes its own report, and the
   * runner destroys it when the attempt ends; that destruction is what
   * finalizes the file it links to.
   *
   * The device outlives the agents: the caller keeps the shell channel for the
   * whole run and hands the runner a view of it whose `destroy()` is inert.
   */
  createAgent: (runId: string) => OnDeviceAndroidAgent;
  /**
   * Register the `runAdbShell` YAML step.
   *
   * Off by default, and deliberately separate from
   * `LocalAndroidDeviceOpt.exposeRunAdbShellAction`, which gates the same
   * capability for the *model*. A YAML file is a different author with a
   * different threat model — usually someone else's suite, checked in and run
   * unattended — so enabling one must never enable the other.
   */
  runAdbShell?: boolean;
  /** Files to run, as globs relative to `projectRoot`. Defaults to all YAML. */
  include?: readonly string[];
  /** Project name shown in the report. */
  projectName?: string;
  signal?: AbortSignal;
  /** Human-readable progress lines. */
  onProgress?: (message: string) => void;
  /**
   * Structured progress, in the same vocabulary the task runner uses:
   * `run.start`, `step.start`, `action`, `step.end`, `run.end`. A shell that
   * renders a live progress overlay reads these rather than the text.
   */
  onEvent?: (payload: Record<string, unknown>) => void;
}

export interface AndroidTestProjectSummary {
  total: number;
  passed: number;
  failed: number;
  notRun: number;
  filtered: number;
  collectionErrors: number;
  documentFailures: number;
  projectFailures: number;
}

export interface AndroidTestProjectRunResult {
  /**
   * Project name. Deliberately called `name`: it is what
   * `LocalAgentRunResult.name` carries for a task run, so a shell reading a
   * result does not need two code paths to label it.
   */
  name: string;
  runId: string;
  status: 'success' | 'failed';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  summary: AndroidTestProjectSummary;
  summaryPath: string;
  /** Absolute path to the unified Midscene Test HTML report, when one was written. */
  reportPath?: string;
  cases: readonly CaseRunOutcome[];
  documents: readonly WorkflowDocumentRunResult[];
}

/**
 * Turn a `--include`-style glob into a regexp.
 *
 * Only `**`, `*` and `?` are supported, which is all the `files.include` field
 * needs. A `**` immediately followed by a slash matches zero or more leading
 * segments, so `flows/**` plus a filename also finds files directly in
 * `flows/`, not only in its subdirectories — the same thing the CLI's matcher
 * does. Anything fancier belongs upstream.
 */
function globToRegExp(glob: string): RegExp {
  // `split`/`join` rather than a regex replacement: the placeholders are
  // control characters, and a control character inside a regex literal is both
  // rejected by the linter and easy to misread.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('**/')
    .join('\u0001')
    .split('**')
    .join('\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .split('\u0002')
    .join('.*')
    .split('\u0001')
    .join('(?:.*/)?');
  return new RegExp(`^${escaped}$`);
}

/** Every `.yaml`/`.yml` under `root`, skipping dot-directories. */
function findYamlFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (/\.ya?ml$/i.test(entry.name)) {
        found.push(absolute);
      }
    }
  };
  walk(root);
  return found.sort();
}

function collectSources(
  projectRoot: string,
  include: readonly string[] | undefined,
): CollectedSource[] {
  const files = findYamlFiles(projectRoot);
  const patterns = include?.map(globToRegExp);
  return files
    .map((absolutePath) => ({
      absolutePath,
      sourcePath: path.relative(projectRoot, absolutePath),
    }))
    .filter((source) =>
      patterns
        ? patterns.some((pattern) => pattern.test(source.sourcePath))
        : true,
    );
}

/**
 * Build the node set for a run.
 *
 * The Midscene nodes come from the agent's own registry, so the AI steps and
 * the device steps are declared in one place — see
 * `OnDeviceAndroidAgent.getTestRunnerNodeDefinitions`.
 */
export function buildAndroidTestNodes(options: {
  createAgent: (runId: string) => OnDeviceAndroidAgent;
  runAdbShell?: boolean;
}): readonly NodeDefinition<any, any, undefined>[] {
  /**
   * The node set is declared by the agent class, following upstream — this is
   * the same `AgentTestRunnerNodeProvider` contract `OnDeviceAndroidAgent`
   * implements, with the gated node appended.
   *
   * `createMidsceneNodes` is called exactly once: it also contributes the
   * built-in `wait` node, so calling it twice would register `wait` twice and
   * `NodeRegistry` rejects duplicates.
   */
  const agentClass = {
    getTestRunnerNodeDefinitions: () => [
      ...OnDeviceAndroidAgent.getTestRunnerNodeDefinitions(),
      ...(options.runAdbShell ? [runAdbShellNode] : []),
    ],
  };

  if (options.runAdbShell) {
    debugTestRunner(
      'runAdbShell is ENABLED for YAML: any case in this project can run arbitrary shell commands as the shell user',
    );
  }

  /** The agent for each live case attempt, keyed by its scope id. */
  const agents = new Map<string, OnDeviceAndroidAgent>();

  return createMidsceneNodes<undefined>({
    agentClass,
    agentProvider: {
      getAgent: (runId) => {
        const existing = agents.get(runId);
        if (existing) {
          return existing;
        }
        const created = options.createAgent(runId);
        agents.set(runId, created);
        return created;
      },
      /**
       * Finalize this scope's agent and hand its report to the assembler.
       *
       * The unified report cross-references every step back to the Midscene
       * report the agent wrote, for screenshots, model calls and token counts.
       * That link is the `attempt.reportPaths` the engine collects, and
       * `releaseAgent` is the only thing that fills it: with a bare `getAgent`
       * the run summary is right but every step reads "detail could not be
       * resolved" and the report claims 0 model calls.
       *
       * The report has to be **this scope's own file**. Handing the same file
       * to two scopes makes assembly fail outright — "Agent report source is
       * shared by multiple test scopes" — which is why there is an agent per
       * case rather than one for the run.
       */
      releaseAgent: async (runId) => {
        const agent = agents.get(runId);
        if (!agent) {
          return undefined;
        }
        agents.delete(runId);
        try {
          // destroy() flushes and finalizes the report, and is what sets
          // reportFile to the finalized path.
          await agent.destroy();
        } catch (error) {
          debugTestRunner(
            `finalizing the report for ${runId} failed: ${error}`,
          );
        }
        const reportPath = agent.reportFile;
        return reportPath && fs.existsSync(reportPath)
          ? { reportPath }
          : undefined;
      },
    },
  });
}

const RUN_ID_SAFE = /[^0-9A-Za-z._-]/g;

/** Run id: sortable, filename-safe, unique per call. */
export function createRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(RUN_ID_SAFE, '-').replace(/Z$/, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

/**
 * Execute every YAML document in a project and write the unified report.
 *
 * Lifecycle, steps and reporting are upstream's engine; this function only
 * decides *what* runs and persists the outcome. Project-level setup/teardown,
 * tag selection, retries, concurrency and bail are not implemented — the app
 * owns the device for the whole run, so there is nothing for a project setup
 * hook to acquire.
 */
export async function runAndroidTestProject(
  options: RunAndroidTestProjectOptions,
): Promise<AndroidTestProjectRunResult> {
  const projectRoot = path.resolve(options.projectRoot);
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`Test project directory not found: ${projectRoot}`);
  }

  const projectName = options.projectName ?? path.basename(projectRoot);
  const projectId = projectName;
  const runId = createRunId();
  const startedAt = new Date();

  const runDir = path.join(path.resolve(options.resultDir), runId);
  const reportDir = path.resolve(options.reportDir);
  const summaryPath = path.join(runDir, 'summary.json');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const nodes = buildAndroidTestNodes({
    createAgent: options.createAgent,
    runAdbShell: options.runAdbShell,
  });
  const registry = new NodeRegistry(nodes);
  /** Collection tolerates a miss so it can name the unknown node in its error. */
  const lookupNode = (name: string) =>
    registry.get(name) as NodeDefinition<any, any, undefined> | undefined;
  /** Running happens only after collection resolved every name. */
  const resolveNode = (name: string) => {
    const node = lookupNode(name);
    if (!node) {
      throw new Error(`Unknown Midscene Test node: ${name}`);
    }
    return node;
  };

  const sources = collectSources(projectRoot, options.include);
  const progress = options.onProgress ?? (() => {});
  /**
   * Structured progress, using the same `[event]` vocabulary as the task
   * runner so the host app's overlay and notification work for a test run too.
   * Without it the phone shows a run with no step counter at all.
   */
  const emit = (payload: Record<string, unknown>) => options.onEvent?.(payload);

  /**
   * The switch that turns on `runAdbShell` is the one setting here that widens
   * what a checked-in YAML file can do to the device, so it is announced every
   * run rather than only documented. Silence would make it easy to inherit from
   * a copied config without noticing.
   */
  if (options.runAdbShell) {
    progress(
      'WARNING: the runAdbShell step is ENABLED. Every YAML file in this project can run arbitrary shell commands on this device as the shell user — including files you did not write.',
    );
  }

  progress(`midscene-test: ${sources.length} document(s) under ${projectRoot}`);

  const documents: WorkflowDocumentRunResult[] = [];
  const cases: (CaseRunOutcome & { documentId: string })[] = [];
  const collectionErrors: {
    projectId: string;
    projectName: string;
    sourcePath: string;
    error: unknown;
  }[] = [];

  /**
   * Collect every document before running any of them.
   *
   * Parsing is side-effect free, and doing it up front is what makes an honest
   * `total` available to the progress events — the case count is otherwise only
   * known after the last case has already run.
   */
  const collected: {
    source: CollectedSource;
    document: ReturnType<typeof collectWorkflowDocument>;
  }[] = [];
  for (const source of sources) {
    try {
      collected.push({
        source,
        document: collectWorkflowDocument(
          {
            projectId,
            projectName,
            sourcePath: source.sourcePath,
            absolutePath: source.absolutePath,
          },
          { resolveNode: lookupNode },
        ),
      });
    } catch (error) {
      // A file that will not parse is a collection error, not a run failure:
      // the CLI keeps going and reports it, so a single bad YAML does not hide
      // the results of the files that are fine.
      debugTestRunner(`collection failed for ${source.sourcePath}: ${error}`);
      collectionErrors.push({
        projectId,
        projectName,
        sourcePath: source.sourcePath,
        error,
      });
    }
  }

  const caseTotal = collected.reduce(
    (total, item) => total + item.document.cases.length,
    0,
  );
  emit({
    event: 'run.start',
    name: projectName,
    total: caseTotal,
    startedAt: startedAt.getTime(),
  });

  let caseIndex = 0;
  for (const item of collected) {
    options.signal?.throwIfAborted();
    progress(`running ${item.source.sourcePath}`);

    const execution = await runWorkflowDocument(item.document, {
      resolveNode,
      ...(options.signal ? { signal: options.signal } : {}),
      onCaseStart: (collectedCase) => {
        caseIndex += 1;
        emit({
          event: 'step.start',
          index: caseIndex,
          total: caseTotal,
          // A case is the unit the person watching the phone counts, so it
          // drives the counter; the node underneath is the finer detail.
          phase: 'acting',
          prompt: collectedCase.definition.name,
          startedAt: Date.now(),
        });
      },
      onStepStart: (info) => {
        const where =
          info.scope === 'case' ? info.case.name : info.document.sourcePath;
        progress(`  ${item.source.sourcePath} · ${where} · ${info.node}`);
        emit({ event: 'action', tip: `${where} · ${info.node}` });
      },
      onCaseResult: (result) => {
        emit({
          event: 'step.end',
          status: result.status === 'success' ? 'ok' : 'error',
          name: result.name,
        });
      },
    });

    documents.push(execution.document);
    for (const outcome of execution.cases) {
      cases.push({ ...outcome, documentId: execution.document.documentId });
    }
  }

  const endedAt = new Date();
  const passed = cases.filter((item) => item.status === 'success').length;
  const failed = cases.filter((item) => item.status === 'failed').length;
  const notRun = cases.filter((item) => item.status === 'not-run').length;
  const documentFailures = documents.filter(
    (item) => item.status === 'failed',
  ).length;
  const summary: AndroidTestProjectSummary = {
    total: cases.length,
    passed,
    failed,
    notRun,
    filtered: 0,
    collectionErrors: collectionErrors.length,
    documentFailures,
    projectFailures: 0,
  };
  const status: 'success' | 'failed' =
    failed > 0 ||
    notRun > 0 ||
    documentFailures > 0 ||
    collectionErrors.length > 0
      ? 'failed'
      : 'success';

  emit({
    event: 'run.end',
    name: projectName,
    status: status === 'success' ? 'ok' : 'error',
    ms: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    failed,
  });

  /**
   * The report mapper is upstream's, but its input type is the CLI's internal
   * `TestProjectRunResult` and is not exported. `Parameters<>` names it without
   * importing it, so the shape stays checked against the real signature instead
   * of being asserted away.
   */
  const reportInput = {
    schemaVersion: 3 as const,
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    status,
    exitCode: status === 'success' ? (0 as const) : (1 as const),
    resultDir: path.resolve(options.resultDir),
    summaryPath,
    reportDir,
    summary,
    projects: [
      {
        projectId,
        name: projectName,
        status,
        retry: 0,
        fileSelection: { include: options.include ?? ['**/*.yaml'] },
        tagSelection: { include: [], exclude: [] },
        sourceCount: sources.length,
        selectedCaseCount: cases.length,
        filteredCaseCount: 0,
        cases,
        documents,
        collectionErrors,
      },
    ],
    cases,
    documents,
    collectionErrors,
  } as unknown as Parameters<typeof collectTestRunReportSources>[0];

  let reportPath: string | undefined;
  try {
    reportPath = new TestRunReportAssembler().assemble({
      outputDir: reportDir,
      reportFileName: `test-run-${runId}`,
      sources: collectTestRunReportSources(reportInput),
      buildRunnerDump: (index) => buildTestRunReportDump(reportInput, index),
    });
  } catch (error) {
    // The run itself succeeded or failed on its own terms; a report that could
    // not be written must not be reported as a test failure.
    debugTestRunner(`report assembly failed: ${error}`);
    progress(`warning: could not write the report: ${error}`);
  }

  const result: AndroidTestProjectRunResult = {
    name: projectName,
    runId,
    status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    summary,
    summaryPath,
    ...(reportPath ? { reportPath } : {}),
    cases,
    documents,
  };

  // Persisted so a UI can list runs without parsing the HTML report.
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        ...result,
        // The full case objects carry report traces; keep the file small and
        // keep the structure stable for a reader.
        cases: cases.map((item) => ({
          caseId: item.caseId,
          name: item.name,
          sourcePath: item.sourcePath,
          caseIndex: item.caseIndex,
          status: item.status,
          notRunReason: item.notRunReason,
          durationMs: item.run?.durationMs,
        })),
        documents: documents.map((item) => ({
          documentId: item.documentId,
          sourcePath: item.sourcePath,
          status: item.status,
          durationMs: item.durationMs,
        })),
        collectionErrors: collectionErrors.map((item) => ({
          sourcePath: item.sourcePath,
          message:
            item.error instanceof Error
              ? item.error.message
              : String(item.error),
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  return result;
}
