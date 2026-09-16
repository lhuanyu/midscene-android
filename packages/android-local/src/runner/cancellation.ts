/** Keep the host's stop channel open only while a CLI run owns it. */
export async function withRunCancellation<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const stdin = process.stdin;
  const piped = !stdin.isTTY;
  const onSignal = (signal: NodeJS.Signals) => {
    console.error(
      `[midscene-local] ${signal}: stopping after the current step, then writing the report`,
    );
    controller.abort(new Error(`interrupted by ${signal}`));
  };
  const onData = (chunk: string) => {
    if (!chunk.includes('stop')) return;
    console.error(
      '[midscene-local] stop requested by the host: finishing the current step, then writing the report',
    );
    controller.abort(new Error('stopped by the host'));
  };
  const cleanup = () => {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    controller.signal.removeEventListener('abort', cleanup);
    if (piped) {
      stdin.removeListener('data', onData);
      // The host keeps its end open until this process exits. A resumed stdin
      // otherwise keeps Node alive after the result and report are complete.
      stdin.destroy();
    }
  };

  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  controller.signal.addEventListener('abort', cleanup, { once: true });
  if (piped) {
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  }
  try {
    return await run(controller.signal);
  } finally {
    cleanup();
  }
}
