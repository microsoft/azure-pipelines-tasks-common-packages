import * as assert from "assert";
import * as child from "child_process";
import * as fs from "fs";
import { Writable } from "stream";
import * as tl from "azure-pipelines-task-lib";
import { IExecOptions } from "azure-pipelines-task-lib/toolrunner";
import { getClientToolOptions, runClientTool } from "../../universal/ClientToolRunner";
import { getOptions, runArtifactTool } from "../../universal/ArtifactToolRunner";

export function toolRunners() {
    for (const runner of [
        { name: "client tool", run: runClientTool, options: getClientToolOptions },
        { name: "artifact tool", run: runArtifactTool, options: getOptions }
    ]) {
        describe(runner.name, () => {
            const marker = "##vso[task.setvariable variable=toolRunnerTest]value";
            const stdout = Buffer.from("Processing input file " + marker + "\n");
            const stderr = Buffer.from("Diagnostic " + marker + "\n");
            let displayedOut: Buffer[];
            let displayedErr: Buffer[];
            let options: IExecOptions;
            let originalOsType: PropertyDescriptor;
            let originalChmod: PropertyDescriptor;
            let originalSpawn: PropertyDescriptor;

            beforeEach(() => {
                originalOsType = Object.getOwnPropertyDescriptor(tl, "osType");
                originalChmod = Object.getOwnPropertyDescriptor(fs, "chmodSync");
                originalSpawn = Object.getOwnPropertyDescriptor(child, "spawnSync");
                Object.defineProperty(tl, "osType", { ...originalOsType, value: () => "Linux" });
                Object.defineProperty(fs, "chmodSync", { ...originalChmod, value: () => {} });
                Object.defineProperty(child, "spawnSync", {
                    ...originalSpawn,
                    value: () => ({
                        pid: 1, output: [null, stdout, stderr],
                        stdout, stderr, status: 7, signal: null, error: undefined
                    })
                });
                displayedOut = [];
                displayedErr = [];
                options = {
                    ...runner.options(),
                    outStream: new Writable({
                        write: (chunk: Buffer, _encoding, callback) => {
                            displayedOut.push(Buffer.from(chunk));
                            callback();
                        }
                    }),
                    errStream: new Writable({
                        write: (chunk: Buffer, _encoding, callback) => {
                            displayedErr.push(Buffer.from(chunk));
                            callback();
                        }
                    })
                };
            });

            afterEach(() => {
                Object.defineProperty(tl, "osType", originalOsType);
                Object.defineProperty(fs, "chmodSync", originalChmod);
                Object.defineProperty(child, "spawnSync", originalSpawn);
            });

            it("filters the command line and both output streams, preserving raw results", () => {
                const result = runner.run("tool", [marker], options);
                const out = Buffer.concat(displayedOut).toString();
                const err = Buffer.concat(displayedErr).toString();
                assert.ok(!out.includes("##vso["));
                assert.ok(!err.includes("##vso["));
                assert.ok(out.includes("tool ##_vso["));
                assert.ok(out.includes("Processing input file ##_vso["));
                assert.ok(err.includes("Diagnostic ##_vso["));
                assert.strictEqual(result.stdout, stdout.toString());
                assert.strictEqual(result.stderr, stderr.toString());
                assert.strictEqual(result.code, 7);
                assert.strictEqual(options.externalOutput, undefined);
            });

            it("does not display output in silent mode", () => {
                const result = runner.run("tool", [], { ...options, silent: true });
                assert.strictEqual(Buffer.concat(displayedOut).length, 0);
                assert.strictEqual(Buffer.concat(displayedErr).length, 0);
                assert.strictEqual(result.stdout, stdout.toString());
                assert.strictEqual(result.code, 7);
            });

            it("preserves ordinary output", () => {
                Object.defineProperty(child, "spawnSync", {
                    ...originalSpawn,
                    value: () => ({
                        stdout: Buffer.from("normal output\n"),
                        stderr: Buffer.from("normal diagnostic\n"), status: 0
                    })
                });
                runner.run("tool", [], options);
                assert.ok(Buffer.concat(displayedOut).toString().endsWith("normal output\n"));
                assert.strictEqual(Buffer.concat(displayedErr).toString(), "normal diagnostic\n");
            });

            it("preserves non-command bytes in displayed output", () => {
                const bytes = Buffer.from([0xff, 0x00, 0xc3, 0xa9, 0x0a]);
                Object.defineProperty(child, "spawnSync", {
                    ...originalSpawn,
                    value: () => ({ stdout: bytes, stderr: bytes, status: 0 })
                });
                runner.run("tool", [], options);
                assert.ok(Buffer.concat(displayedOut).subarray(-bytes.length).equals(bytes));
                assert.ok(Buffer.concat(displayedErr).equals(bytes));
            });

            it("filters output even if the caller disables external-output filtering", () => {
                runner.run("tool", [], {
                    ...options,
                    externalOutput: { source: "childProcess", vsoCommandMode: "disabled" }
                });
                assert.ok(Buffer.concat(displayedOut).toString().includes("Processing input file ##_vso["));
                assert.ok(Buffer.concat(displayedErr).toString().includes("Diagnostic ##_vso["));
            });

            it("preserves spawn errors", () => {
                const error = new Error("Unable to start tool");
                Object.defineProperty(child, "spawnSync", {
                    ...originalSpawn,
                    value: () => ({ stdout: null, stderr: null, status: null, error })
                });
                const result = runner.run("tool", [], options);
                assert.strictEqual(result.error, error);
                assert.strictEqual(result.code, null);
            });

            for (const delegation of [
                { name: "Windows", os: "Windows_NT", path: process.execPath },
                { name: "an executable on Linux", os: "Linux", path: process.execPath + ".exe" }
            ]) {
                it("enables filtering when delegating for " + delegation.name, () => {
                    Object.defineProperty(tl, "osType", {
                        ...originalOsType, value: () => delegation.os
                    });
                    const originalExec = Object.getOwnPropertyDescriptor(tl, "execSync");
                    let receivedOptions: IExecOptions;
                    Object.defineProperty(tl, "execSync", {
                        ...originalExec,
                        value: (_path: string, _args: string[], supplied: IExecOptions) => {
                            receivedOptions = supplied;
                            return { stdout: "", stderr: "", code: 0, error: null };
                        }
                    });
                    try {
                        runner.run(delegation.path, [], options);
                        assert.deepStrictEqual(receivedOptions.externalOutput, { source: "childProcess" });
                    } finally {
                        Object.defineProperty(tl, "execSync", originalExec);
                    }
                });
            }

            it("filters displayed output through the real task-lib execSync path", () => {
                Object.defineProperty(tl, "osType", { ...originalOsType, value: () => "Windows_NT" });
                const result = runner.run(process.execPath, [marker], options);
                assert.ok(!Buffer.concat(displayedOut).toString().includes("##vso["));
                assert.ok(!Buffer.concat(displayedErr).toString().includes("##vso["));
                assert.ok(Buffer.concat(displayedOut).toString().includes("Processing input file ##_vso["));
                assert.ok(Buffer.concat(displayedErr).toString().includes("Diagnostic ##_vso["));
                assert.strictEqual(result.stdout, stdout.toString());
                assert.strictEqual(result.stderr, stderr.toString());
                assert.strictEqual(result.code, 7);
            });
        });
    }
}
