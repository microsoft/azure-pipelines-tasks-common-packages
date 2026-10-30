import assert = require("assert");
import { filterExternalOutput } from "azure-pipelines-task-lib/externaloutput";

// Set environment variables required by azure-pipelines-task-lib before importing it
process.env['INPUT_BUILDCONTEXT'] = '/tmp/build';
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = '/tmp/work';

import * as containerImageUtils from "../containerimageutils";

/**
 * Minimal mock for ToolRunner.execSync() that mirrors the real
 * ToolRunner.execSync() implementation exactly (see toolrunner.js):
 * it writes a filtered copy of stdout/stderr to outStream/errStream when
 * `options.externalOutput` is set, but always returns the RAW,
 * unfiltered stdout/stderr to the caller. getImageDigest() depends on that
 * raw return value being valid JSON.
 */
class MockToolRunner {
    public lastExecSyncOptions: any = null;

    constructor(private result: { stdout?: string; stderr?: string; code?: number }) { }

    arg(_val: string | string[]): void { }

    execSync(options?: any): any {
        this.lastExecSyncOptions = options;
        const ext = options && options.externalOutput;
        const outStream = (options && options.outStream) || process.stdout;
        const errStream = (options && options.errStream) || process.stderr;

        if (this.result.stdout) {
            outStream.write(ext ? filterExternalOutput(this.result.stdout, ext) : this.result.stdout);
        }
        if (this.result.stderr) {
            errStream.write(ext ? filterExternalOutput(this.result.stderr, ext) : this.result.stderr);
        }

        return {
            code: this.result.code === undefined ? 0 : this.result.code,
            error: null,
            stdout: this.result.stdout || "",
            stderr: this.result.stderr || ""
        };
    }
}

/**
 * Mock ContainerConnection that hands out a dedicated MockToolRunner for the
 * "pull" command and another for the "inspect" command, matching how
 * getImageDigest() calls connection.createCommand() once per command.
 */
class MockContainerConnection {
    public pullRunner: MockToolRunner;
    public inspectRunner: MockToolRunner;
    private createCommandCallCount = 0;

    constructor(
        pullResult: { stdout?: string; stderr?: string; code?: number },
        inspectResult: { stdout?: string; stderr?: string; code?: number }
    ) {
        this.pullRunner = new MockToolRunner(pullResult);
        this.inspectRunner = new MockToolRunner(inspectResult);
    }

    createCommand(): any {
        this.createCommandCallCount++;
        return this.createCommandCallCount === 1 ? this.pullRunner : this.inspectRunner;
    }
}

function captureLiveOutput(action: () => void): { stdout: string; stderr: string } {
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let stdout = "";
    let stderr = "";

    process.stdout.write = ((chunk: any) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
    }) as any;
    process.stderr.write = ((chunk: any) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
    }) as any;

    try {
        action();
    } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }

    return { stdout, stderr };
}

function inspectJson(repoDigest: string, extra?: object): string {
    return JSON.stringify([{ RepoDigests: [repoDigest], ...extra }]);
}

export function runContainerImageUtilsSanitizationTests() {

    describe('getImageDigest() execSync() sanitization', () => {

        it('calls execSync() with externalOutput when pulling the image', () => {
            const connection = new MockContainerConnection(
                { stdout: "Status: Downloaded newer image" },
                { stdout: inspectJson("myimage@sha256:abc123") }
            );

            captureLiveOutput(() => containerImageUtils.getImageDigest(connection as any, "myimage"));

            assert.ok(connection.pullRunner.lastExecSyncOptions, "pull execSync should receive options");
            assert.strictEqual(connection.pullRunner.lastExecSyncOptions.externalOutput.source, "childProcess");
            assert.strictEqual(connection.pullRunner.lastExecSyncOptions.externalOutput.enableVsoCommands, true);
        });

        it('calls execSync() with externalOutput when inspecting the image', () => {
            const connection = new MockContainerConnection(
                { stdout: "Status: Downloaded newer image" },
                { stdout: inspectJson("myimage@sha256:abc123") }
            );

            captureLiveOutput(() => containerImageUtils.getImageDigest(connection as any, "myimage"));

            assert.ok(connection.inspectRunner.lastExecSyncOptions, "inspect execSync should receive options");
            assert.strictEqual(connection.inspectRunner.lastExecSyncOptions.externalOutput.source, "childProcess");
            assert.strictEqual(connection.inspectRunner.lastExecSyncOptions.externalOutput.enableVsoCommands, true);
        });

        it('neutralizes a malicious ##vso[ marker in pull/inspect output written to the live log', () => {
            const connection = new MockContainerConnection(
                { stderr: "##vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh" },
                { stdout: inspectJson("myimage@sha256:abc123"), stderr: "##vso[task.setvariable variable=X]y" }
            );

            const live = captureLiveOutput(() =>
                containerImageUtils.getImageDigest(connection as any, "myimage")
            );

            assert.ok(!live.stderr.includes("##vso["),
                "live stderr for pull/inspect must not contain a raw ##vso[ marker");
            assert.ok(live.stderr.includes("##_vso[task.setvariable"),
                "sanitized marker should still be visible in the live log");
        });

        it('neutralizes a malicious ##vso[ marker arriving via stdout written to the live log', () => {
            // Unlike the stderr case above, a nonempty stdout never short-circuits
            // runPullImageCommand()/runInspectImageCommand(), so both commands'
            // stdout reaches the live log on every run - this is the common case,
            // not just the stderr-on-failure path.
            const maliciousInspectJson = inspectJson("myimage@sha256:abc123", {
                Comment: "##vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh"
            });
            const connection = new MockContainerConnection(
                { stdout: "Pulling from library/myimage\n##vso[task.setvariable variable=X]y" },
                { stdout: maliciousInspectJson }
            );

            const live = captureLiveOutput(() =>
                containerImageUtils.getImageDigest(connection as any, "myimage")
            );

            assert.ok(!live.stdout.includes("##vso["),
                "live stdout for pull/inspect must not contain a raw ##vso[ marker");
            assert.ok(live.stdout.includes("##_vso[task.setvariable"),
                "sanitized marker(s) should still be visible in the live log");
        });

        it('keeps the raw inspect stdout intact as valid JSON despite a marker elsewhere in the output', () => {
            // The marker sits in a field getImageDigest() never reads, so if
            // execSync() returned the SANITIZED copy instead of the raw one,
            // this would still parse - the real assertion is that sanitization
            // never touches the bytes handed back to JSON.parse().
            const connection = new MockContainerConnection(
                { stdout: "Status: Downloaded newer image" },
                { stdout: inspectJson("myimage@sha256:abc123", { Comment: "##vso[task.setvariable variable=X]y" }) }
            );

            let digest: string;
            captureLiveOutput(() => {
                digest = containerImageUtils.getImageDigest(connection as any, "myimage");
            });

            assert.strictEqual(digest, "sha256:abc123");
        });

        it('leaves clean Docker output unchanged in the live log', () => {
            const connection = new MockContainerConnection(
                { stdout: "Status: Image is up to date" },
                { stdout: inspectJson("myimage@sha256:abc123") }
            );

            const live = captureLiveOutput(() =>
                containerImageUtils.getImageDigest(connection as any, "myimage")
            );

            assert.ok(live.stdout.includes("Status: Image is up to date"),
                "clean pull output should pass through unmodified");
            assert.ok(live.stdout.includes(inspectJson("myimage@sha256:abc123")),
                "clean inspect output should pass through unmodified");
        });
    });
}
