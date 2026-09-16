package com.midscene.android;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * What "the agent runtime is installed" and "the extracted bundle is current" each mean.
 *
 * Both questions used to be answered by the same comparison: the {@code runtime-ready}
 * receipt holds the bundle stamp that was current when provisioning finished, and an APK's
 * stamp is regenerated on every build — so the first launch after an app update reported the
 * runtime as missing on a device where nothing had been removed. The banner that raises sends
 * the user to re-install an install that is already there, while the run path re-unpacks the
 * bundle by itself when it is stale ({@link Provisioner#extractAgent}).
 *
 * These tests pin the two answers apart: installed means the files are on the device, and
 * stale means the extracted bundle is not the one this APK carries.
 */
public class ProvisionerStatusTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    /** A file that exists; only its presence is ever read. */
    private static File file(File folder, String name) throws Exception {
        File target = new File(folder, name);
        java.nio.file.Files.write(target.toPath(), new byte[]{1});
        return target;
    }

    /** One install's worth of paths, so a case can leave exactly one of them out. */
    private final class Install {
        final File node;
        final File cli;
        final File receipt;

        Install(String node, String cli, String receipt) throws Exception {
            File folder = temp.newFolder("install-" + (installsCreated++));
            this.node = node == null ? new File(folder, "libnodebin.so") : file(folder, node);
            this.cli = cli == null ? new File(folder, "cli.js") : file(folder, cli);
            this.receipt = receipt == null
                    ? new File(folder, "runtime-ready") : file(folder, receipt);
        }

        boolean present() {
            return Provisioner.runtimePresent(node, cli, receipt);
        }
    }

    /** Folder names have to differ, and each install needs its own. */
    private int installsCreated;

    @Test
    public void aRuntimeWithItsFilesOnDiskCountsAsInstalled() throws Exception {
        assertTrue(new Install("libnodebin.so", "cli.js", "runtime-ready").present());
    }

    @Test
    public void aReceiptFromAnotherBundleDoesNotUninstallTheRuntime() throws Exception {
        // The receipt's contents are not read any more: it records a finished install. An
        // update ships a new bundle stamp, and that must not read as "not installed".
        Install install = new Install("libnodebin.so", "cli.js", "runtime-ready");
        java.nio.file.Files.write(install.receipt.toPath(),
                "userservice-pipe-v2:1.0.0-rc.3-1789538895638".getBytes("UTF-8"));
        assertTrue(install.present());
    }

    @Test
    public void aRuntimeMissingAnyFileIsNotInstalled() throws Exception {
        // Provisioning was never finished, so no verification has ever passed on this device.
        assertFalse("no receipt", new Install("libnodebin.so", "cli.js", null).present());
        assertFalse("no agent bundle", new Install("libnodebin.so", null, "runtime-ready").present());
        assertFalse("no node", new Install(null, "cli.js", "runtime-ready").present());
    }

    @Test
    public void aDirectoryWhereAFileBelongsIsNotInstalled() throws Exception {
        // isFile, not exists: an interrupted unpack can leave the path there, empty.
        Install install = new Install("libnodebin.so", "cli.js", "runtime-ready");
        File directory = new File(install.cli.getParentFile(), "not-a-file.js");
        assertTrue(directory.mkdirs());
        assertFalse(Provisioner.runtimePresent(install.node, directory, install.receipt));
    }

    @Test
    public void theExtractedBundleIsStaleOnlyWhenItIsNotTheOneTheApkCarries() throws Exception {
        File cli = file(temp.newFolder("agent"), "cli.js");
        assertFalse("same stamp, nothing to do",
                Provisioner.bundleIsStale(cli, "1.0.0-rc.4-2", "1.0.0-rc.4-2"));
        assertTrue("a new APK carries a new bundle",
                Provisioner.bundleIsStale(cli, "1.0.0-rc.4-2", "1.0.0-rc.3-1"));
        assertTrue("the other direction: a downgrade is a different bundle too",
                Provisioner.bundleIsStale(cli, "1.0.0-rc.3-1", "1.0.0-rc.4-2"));
        assertTrue("nothing extracted yet",
                Provisioner.bundleIsStale(cli, "1.0.0-rc.4-2", ""));
        // An APK that cannot say what it carries is not a reason to replace what is there:
        // the stamp file is only ever compared against a stamp.
        assertFalse("an unstamped APK is not a newer bundle",
                Provisioner.bundleIsStale(cli, "", "1.0.0-rc.3-1"));
    }

    @Test
    public void anUnstampedApkKeepsAWorkingBundle() throws Exception {
        // No stamp in the APK means it cannot say what it carries, so the bundle on the device
        // is kept: re-unpacking 40 MB on every launch would be worse than running it.
        File agent = temp.newFolder("agent");
        assertFalse(Provisioner.bundleIsStale(file(agent, "cli.js"), "", ""));
        assertFalse(Provisioner.bundleIsStale(file(agent, "cli.js"), "", "1.0.0-rc.3-1"));
    }

    @Test
    public void anEmptyAgentDirectoryIsAlwaysReUnpacked() throws Exception {
        // Whatever the APK says about itself: there is nothing to run otherwise. A bundle that
        // unpacks without leaving a stamp used to report itself as up to date here.
        File missing = new File(temp.newFolder("agent"), "cli.js");
        assertTrue(Provisioner.bundleIsStale(missing, "", ""));
        assertTrue(Provisioner.bundleIsStale(missing, "1.0.0-rc.4-2", "1.0.0-rc.4-2"));
        assertTrue(Provisioner.bundleIsStale(missing, "", "1.0.0-rc.3-1"));
    }
}
