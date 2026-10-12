import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";
import { Writable } from "stream";

// Captures everything written to a stream so tests can assert on it.
class CapturingWritable extends Writable {
    public chunks: Buffer[] = [];
    _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void): void {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
    }
    public text(): string {
        return Buffer.concat(this.chunks).toString("utf8");
    }
}

export function clientToolRunner() {
    before(() => {
        mocker.disable();
        mocker.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        } as mocker.MockOptions);
    });

    after(() => {
        mocker.disable();
    });

    beforeEach(() => {
        mocker.resetCache();
    });

    afterEach(() => {
        mocker.deregisterAll();
    });

    // Loads ClientToolRunner with spawnSync/chmodSync stubbed and the real task-lib.
    function loadClientToolRunnerWithSpawnResult(spawnResult: { stdout?: string; stderr?: string }) {
        const tl = require("azure-pipelines-task-lib");
        (tl as any).osType = () => "Linux";

        mocker.registerMock("fs", {
            chmodSync: (_path: string, _mode: string) => {}
        });
        mocker.registerMock("child_process", {
            spawnSync: (_path: string, _args: string[], _options: any) => ({
                status: 0,
                error: undefined,
                stdout: spawnResult.stdout !== undefined ? Buffer.from(spawnResult.stdout) : undefined,
                stderr: spawnResult.stderr !== undefined ? Buffer.from(spawnResult.stderr) : undefined
            })
        });

        return require("../../universal/ClientToolRunner");
    }

    it("getClientToolOptions enables the external-output filter for the client tool's own stdout/stderr", () => {
        const clientToolRunner = loadClientToolRunnerWithSpawnResult({});
        const options = clientToolRunner.getClientToolOptions();

        assert(options.externalOutput, "externalOutput should be set so non-Windows stdout/stderr get filtered");
        assert.strictEqual(options.externalOutput.source, "childProcess");
    });

    it("neutralizes a ##vso[ marker embedded in the client tool's stdout on non-Windows", () => {
        const maliciousPath = "Processing input file /bin/##vso[task.setvariable variable=FOO]bar/x.pdb";
        const clientToolRunner = loadClientToolRunnerWithSpawnResult({ stdout: maliciousPath });

        const outStream = new CapturingWritable();
        const errStream = new CapturingWritable();
        const execOptions = clientToolRunner.getClientToolOptions();
        execOptions.outStream = outStream;
        execOptions.errStream = errStream;

        clientToolRunner.runClientTool("/fake/path/to/client-tool", ["arg1"], execOptions);

        const written = outStream.text();
        assert(!written.includes("##vso["), `output must not contain an unneutralized ##vso[ marker, got: ${written}`);
        assert(written.includes("##_vso["), `output should contain the neutralized marker, got: ${written}`);
    });

    it("neutralizes a ##vso[ marker embedded in the client tool's stderr on non-Windows", () => {
        const maliciousPath = "##vso[task.setvariable variable=FOO]bar";
        const clientToolRunner = loadClientToolRunnerWithSpawnResult({ stderr: maliciousPath });

        const outStream = new CapturingWritable();
        const errStream = new CapturingWritable();
        const execOptions = clientToolRunner.getClientToolOptions();
        execOptions.outStream = outStream;
        execOptions.errStream = errStream;

        clientToolRunner.runClientTool("/fake/path/to/client-tool", ["arg1"], execOptions);

        const written = errStream.text();
        assert(!written.includes("##vso["), `stderr must not contain an unneutralized ##vso[ marker, got: ${written}`);
        assert(written.includes("##_vso["), `stderr should contain the neutralized marker, got: ${written}`);
    });

    it("still writes benign stdout unchanged on non-Windows", () => {
        const benignOutput = "Processing input file /bin/app/x.pdb";
        const clientToolRunner = loadClientToolRunnerWithSpawnResult({ stdout: benignOutput });

        const outStream = new CapturingWritable();
        const errStream = new CapturingWritable();
        const execOptions = clientToolRunner.getClientToolOptions();
        execOptions.outStream = outStream;
        execOptions.errStream = errStream;

        clientToolRunner.runClientTool("/fake/path/to/client-tool", ["arg1"], execOptions);

        assert(outStream.text().includes(benignOutput), "benign output should pass through unchanged");
    });
}
