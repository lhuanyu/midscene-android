package com.midscene.android;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.InterruptedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Shared process plumbing: running the bundled Node CLI. */
public final class ShellRunner {

    /** How long a stopped child may take to flush before it is killed. */
    private static final int EXIT_GRACE_SECONDS = 30;

    /** Bounded so a stream that keeps reporting interruptions cannot spin. */
    private static final int READ_RETRY_LIMIT = 200;

    private ShellRunner() {
    }

    public static final class Result {
        public final int exitCode;
        public final String output;
        public final long durationMs;

        Result(int exitCode, String output, long durationMs) {
            this.exitCode = exitCode;
            this.output = output;
            this.durationMs = durationMs;
        }

        public boolean ok() {
            return exitCode == 0;
        }

        /**
         * A run that ended without the CLI reporting anything.
         *
         * Used when a stop outruns the grace period or the transport fails: the
         * caller still records the run, so `-1` is what "no exit code" looks
         * like rather than something a shell could have produced.
         */
        static Result stopped(long startedAtMs) {
            return new Result(
                    -1,
                    "",
                    Math.max(0, System.currentTimeMillis() - startedAtMs));
        }
    }

    /**
     * Run the bundled CLI (`node <filesDir>/agent/node_modules/midscene-android/
     * dist/lib/cli.js …`) and stream every line to the sink. `LD_LIBRARY_PATH` points at
     * the native library directory that holds the Node runtime and its dependencies.
     */
    public static Result runCli(
            Context context,
            File workingDir,
            LineSink sink,
            String... args
    ) throws IOException {
        return runCliControlled(context, workingDir, sink, process -> {}, args);
    }

    /** The observer receives the live process and null after it has exited. */
    public static Result runCliControlled(
            Context context,
            File workingDir,
            LineSink sink,
            ProcessListener observer,
            String... args
    ) throws IOException {
        File cli = Provisioner.cliFile(context);
        if (!new File(Provisioner.nodePath(context)).exists()) {
            throw new IOException("node runtime missing at " + Provisioner.nodePath(context));
        }
        if (!cli.exists()) {
            // Name the path: a bare "not extracted yet" hid a bundle-layout mismatch
            // where extraction succeeded at a different location than this lookup.
            throw new IOException("agent bundle not extracted yet (missing "
                    + cli.getAbsolutePath() + "); run Provision in Diagnostics");
        }

        List<String> command = new ArrayList<>();
        command.add(Provisioner.nodePath(context));
        command.add(cli.getAbsolutePath());
        for (String arg : args) {
            command.add(arg);
        }

        ProcessBuilder builder = new ProcessBuilder(command);
        String nativeDir = context.getApplicationInfo().nativeLibraryDir;
        Map<String, String> env = builder.environment();
        env.put("LD_LIBRARY_PATH", nativeDir);
        env.put("HOME", context.getFilesDir().getAbsolutePath());
        env.put("TMPDIR", context.getCacheDir().getAbsolutePath());
        env.put("PATH", nativeDir + ":/system/bin:/system/xbin");
        env.put("MIDSCENE_RUN_DIR", new File(context.getFilesDir(), "run").getAbsolutePath());
        // The shell owns this directory. The bridge reads via a Binder pipe;
        // neither Node nor the app needs filesystem access to it. `doctor` also
        // reads this environment variable.
        env.put("MIDSCENE_FILE_CHANNEL_DIR",
                Provisioner.channelDir(context).getAbsolutePath());
        // The agent reaches the Shizuku user service through the app's loopback
        // bridge; without these the on-device path is unavailable and a run fails
        // fast instead of picking another privilege channel.
        if (!ExecBridge.baseUrl().isEmpty()) {
            env.put("MIDSCENE_EXEC_BRIDGE_URL", ExecBridge.baseUrl());
            env.put("MIDSCENE_EXEC_BRIDGE_TOKEN", ExecBridge.token());
            // Which shell sits behind that bridge. Without it the agent can only
            // guess, and it used to guess "shizuku" on every channel — so a log
            // from an adb-channel run said the run had gone through Shizuku.
            env.put("MIDSCENE_EXEC_CHANNEL", ActiveExec.channel(context));
        }
        env.putAll(readEnvFile(new File(context.getFilesDir(), "model.env"), sink));
        builder.directory(workingDir);
        builder.redirectErrorStream(true);

        if (Thread.currentThread().isInterrupted()) {
            throw new IOException("run cancelled before Node started");
        }
        long startedAt = System.currentTimeMillis();
        Process process = builder.start();
        observer.onProcess(process);
        try {
            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                int readRetries = 0;
                while (true) {
                    try {
                        line = reader.readLine();
                    } catch (InterruptedIOException cutShort) {
                        // Android reports a read that was cut short as an
                        // interrupt rather than as end-of-stream. On a stop the
                        // child is still alive and finishing — it has been asked
                        // to write its report — and the result line this process
                        // prints at the end travels over exactly this stream, so
                        // giving up here throws away the run's own account of
                        // itself. Clear the flag and read on.
                        Thread.interrupted();
                        readRetries += 1;
                        if (readRetries > READ_RETRY_LIMIT) {
                            throw cutShort;
                        }
                        continue;
                    }
                    if (line == null) {
                        break;
                    }
                    output.append(line).append('\n');
                    if (sink != null) {
                        sink.line(line);
                    }
                }
            }

            int exitCode;
            try {
                exitCode = process.waitFor();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                process.destroyForcibly();
                return new Result(-1, output.toString(), System.currentTimeMillis() - startedAt);
            }
            return new Result(exitCode, output.toString(), System.currentTimeMillis() - startedAt);
        } finally {
            observer.onProcess(null);
            // A child that is still alive here ended without closing its stream,
            // which is what a stop looks like from this side. Give it the moment
            // it needs to finish writing; killing it on the spot is what left a
            // stopped run with no report.
            if (process.isAlive()) {
                try {
                    if (!process.waitFor(EXIT_GRACE_SECONDS, TimeUnit.SECONDS)) {
                        process.destroyForcibly();
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    process.destroyForcibly();
                }
            }
        }
    }

    /**
     * Read the credentials file through the same reader the Settings editor uses, so
     * the values the agent receives cannot drift from the ones the screen shows.
     */
    private static Map<String, String> readEnvFile(File file, LineSink sink) {
        Map<String, String> values = new java.util.HashMap<>();
        if (!file.exists()) {
            return values;
        }

        ModelEnvFile.Content content = ModelEnvFile.parse(readText(file));
        if (sink != null) {
            for (int index = 0; index < content.unreadableLines; index++) {
                sink.line("model.env: skipped an unreadable line");
            }
            for (int index = 0; index < content.invalidKeyLines; index++) {
                sink.line("model.env: skipped a line with an invalid key");
            }
            if (!content.isEmpty()) {
                sink.line("model.env: injecting " + content.entries.size() + " variables");
            }
        }
        values.putAll(content.entries);
        return values;
    }

    public static String readText(File file) {
        try {
            return new String(java.nio.file.Files.readAllBytes(file.toPath()),
                    StandardCharsets.UTF_8);
        } catch (IOException error) {
            return "";
        }
    }

    public interface LineSink {
        void line(String line);
    }

    public interface ProcessListener {
        void onProcess(Process process);
    }

}
