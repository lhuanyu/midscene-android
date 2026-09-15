package com.midscene.android;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RunStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    @Test
    public void pruneRemovesOrphanResultsWithoutDiscardingReferencedRun() throws Exception {
        File filesDir = temp.newFolder("files");
        RunStore store = new RunStore(filesDir);
        File results = new File(filesDir, "midscene_run/results");
        assertTrue(results.mkdirs());
        File referenced = new File(results, "kept.json");
        File orphan = new File(results, "orphan.json");
        Files.write(referenced.toPath(), "kept".getBytes(StandardCharsets.UTF_8));
        Files.write(orphan.toPath(), "orphan".getBytes(StandardCharsets.UTF_8));

        store.append(new JSONObject()
                .put("id", "run-1")
                .put("resultFile", referenced.getAbsolutePath()));

        assertEquals(1, store.list().size());
        assertTrue(referenced.isFile());
        assertFalse(orphan.exists());
    }

    @Test
    public void appendKeepsOnlyMostRecentRuns() throws Exception {
        RunStore store = new RunStore(temp.newFolder("files"));
        for (int index = 0; index <= RunStore.MAX_RUNS; index++) {
            store.append(new JSONObject().put("id", "run-" + index));
        }

        assertEquals(RunStore.MAX_RUNS, store.list().size());
        assertFalse(new File(new File(temp.getRoot(), "files/runs"), "run-0.json").exists());
    }

    @Test
    public void recordsWrittenBeforeTestRunsExistedStayTaskRuns() throws Exception {
        RunStore.RunRecord record = new RunStore.RunRecord(new JSONObject().put("id", "old"));

        assertEquals(RunStore.KIND_TASKS, record.kind);
        assertFalse(record.isTestRun());
    }

    @Test
    public void testRunsAreRecognisedByTheirKind() throws Exception {
        RunStore.RunRecord record =
                new RunStore.RunRecord(new JSONObject().put("kind", RunStore.KIND_TEST));

        assertTrue(record.isTestRun());
    }

    /** Writes one test-run record and returns the directories it owns. */
    private File[] appendTestRun(RunStore store, File filesDir) throws Exception {
        File runDir = new File(filesDir, "midscene_run/test-results/run-1");
        assertTrue(runDir.mkdirs());
        File summary = new File(runDir, "summary.json");
        Files.write(summary.toPath(), "{}".getBytes(StandardCharsets.UTF_8));

        File reportDir = new File(filesDir, "midscene_run/report");
        assertTrue(reportDir.mkdirs());
        File report = new File(reportDir, "test-run-1.html");
        Files.write(report.toPath(), "<html/>".getBytes(StandardCharsets.UTF_8));

        store.append(new JSONObject()
                .put("id", "run-1")
                .put("kind", RunStore.KIND_TEST)
                .put("resultFile", summary.getAbsolutePath())
                .put("reportFile", report.getAbsolutePath()));

        return new File[] {runDir, summary, report};
    }

    @Test
    public void pruneKeepsATestRunsSummaryDirectory() throws Exception {
        File filesDir = temp.newFolder("files");
        RunStore store = new RunStore(filesDir);
        File[] artefacts = appendTestRun(store, filesDir);

        assertTrue(artefacts[1].isFile());
        assertTrue(artefacts[2].isFile());
        // Both live outside runs/ and run/report, and used to be invisible to
        // the storage total.
        assertTrue(store.totalBytes() > 0);
    }

    @Test
    public void pruneDropsATestRunNothingPointsAt() throws Exception {
        File filesDir = temp.newFolder("files");
        RunStore store = new RunStore(filesDir);
        File[] artefacts = appendTestRun(store, filesDir);

        store.delete(store.list().get(0));
        store.append(new JSONObject().put("id", "run-2"));

        assertFalse(artefacts[0].exists());
        assertFalse(artefacts[2].exists());
    }
}
