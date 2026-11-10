import assert = require("assert");
import { EventEmitter } from "events";
import { createFilteredWriter } from "azure-pipelines-task-lib/externaloutput";

// Set environment variables required by azure-pipelines-task-lib before importing dockerCommandUtils
process.env['INPUT_BUILDCONTEXT'] = '/tmp/build';
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = '/tmp/work';

import * as dockerCommandUtils from "../dockercommandutils";

/**
 * Minimal mock for ToolRunner that simulates Docker command execution.
 * The real-ToolRunner tests cover process and stream lifecycle behavior; this
 * mock only applies the configured external-output policy to simulated chunks.
 */
class MockToolRunner extends EventEmitter {
    public simulatedStdout: string = "";
    public simulatedStderr: string = "";
    /** When set, stdout is written as separate chunks instead of a single write. */
    public simulatedStdoutChunks: string[] = null;

    arg(_val: string | string[]): void { }
    line(_val: string): void { }

    exec(options?: any): Promise<void> {
        if (this.simulatedStdout) {
            this.emit("stdout", this.simulatedStdout);
        }
        if (this.simulatedStderr) {
            this.emit("stderr", this.simulatedStderr);
        }

        const outStream = options && options.outStream || process.stdout;
        const errStream = options && options.failOnStdErr
            ? options.errStream || process.stderr
            : outStream;
        const stdoutWriter = createFilteredWriter(options.externalOutput, outStream);
        const stderrWriter = errStream === outStream
            ? stdoutWriter
            : createFilteredWriter(options.externalOutput, errStream);

        (this.simulatedStdoutChunks || [this.simulatedStdout])
            .filter(chunk => !!chunk)
            .forEach(chunk => stdoutWriter.write(chunk));
        if (this.simulatedStderr) {
            stderrWriter.write(this.simulatedStderr);
        }

        stdoutWriter.end();
        if (stderrWriter !== stdoutWriter) {
            stderrWriter.end();
        }

        return Promise.resolve();
    }
}

/**
 * Mock ContainerConnection that uses MockToolRunner.
 * Captures exec options and intercepts ToolRunner's display destinations.
 */
class MockContainerConnection {
    public lastExecOptions: any = null;
    public mockToolRunner: MockToolRunner;
    public stdoutWritten: string = "";
    public stderrWritten: string = "";

    constructor(simulatedStdout: string = "", simulatedStderr: string = "") {
        this.mockToolRunner = new MockToolRunner();
        this.mockToolRunner.simulatedStdout = simulatedStdout;
        this.mockToolRunner.simulatedStderr = simulatedStderr;
    }

    createCommand(): MockToolRunner {
        return this.mockToolRunner;
    }

    execCommand(command: MockToolRunner, options?: any): Promise<void> {
        this.lastExecOptions = options;

        // Intercept process.stdout/stderr ONLY during exec to capture what
        // the sanitized stream writes (avoids capturing task-lib debug output)
        const origStdout = process.stdout.write;
        const origStderr = process.stderr.write;
        const self = this;

        process.stdout.write = function (chunk: any, encodingOrCb?: any, cb?: any): boolean {
            self.stdoutWritten += typeof chunk === 'string' ? chunk : chunk.toString();
            const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
            if (typeof callback === 'function') callback();
            return true;
        } as any;

        process.stderr.write = function (chunk: any, encodingOrCb?: any, cb?: any): boolean {
            self.stderrWritten += typeof chunk === 'string' ? chunk : chunk.toString();
            const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
            if (typeof callback === 'function') callback();
            return true;
        } as any;

        return command.exec(options).then(() => {
            process.stdout.write = origStdout;
            process.stderr.write = origStderr;
        }).catch((err) => {
            process.stdout.write = origStdout;
            process.stderr.write = origStderr;
            throw err;
        });
    }
}

export function runDockerCommandSanitizationTests() {

    describe('build()', () => {

        it('Should pass external-output options to execCommand', (done) => {
            const connection = new MockContainerConnection("output");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(connection.lastExecOptions, "execCommand should receive options");
                assert.strictEqual(connection.lastExecOptions.externalOutput.source, "childProcess");
                assert.strictEqual(connection.lastExecOptions.externalOutput.enableVsoCommands, true);
                done();
            }).catch(done);
        });

        it('Should let ToolRunner own output filtering and finalization', (done) => {
            const connection = new MockContainerConnection("output");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.strictEqual(connection.lastExecOptions.outStream, undefined);
                assert.strictEqual(connection.lastExecOptions.errStream, undefined);
                assert.ok(connection.lastExecOptions.externalOutput,
                    "ToolRunner should receive the external-output filtering policy");
                done();
            }).catch(done);
        });

        it('Should sanitize ##vso[task.prependpath] in stdout', (done) => {
            const connection = new MockContainerConnection("##vso[task.prependpath]/tmp/pwned");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "##vso[ should be sanitized before reaching process.stdout");
                assert.ok(connection.stdoutWritten.includes("##_vso[task.prependpath]"),
                    "Sanitized text should still be readable");
                done();
            }).catch(done);
        });

        it('Should sanitize ##vso[ on stderr (BuildKit scenario)', (done) => {
            const connection = new MockContainerConnection("", "##vso[task.setvariable variable=x]y");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "ToolRunner should sanitize stderr routed to its default display stream");
                assert.ok(connection.stdoutWritten.includes("##_vso[task.setvariable"),
                    "Sanitized stderr should still appear in the live output");
                assert.strictEqual(connection.stderrWritten, "",
                    "ToolRunner routes stderr to outStream unless failOnStdErr is set");
                done();
            }).catch(done);
        });

        it('Should still provide raw output to the callback for internal parsing', (done) => {
            const maliciousOutput = '##vso[task.prependpath]/tmp/pwned';
            const connection = new MockContainerConnection(maliciousOutput);

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"],
                (output) => {
                    assert.ok(output.includes("##vso[task.prependpath]"),
                        "Raw callback should receive unsanitized data for image ID extraction");
                }
            ).then(() => {
                done();
            }).catch(done);
        });

        it('Should not modify clean Docker build output', (done) => {
            const cleanOutput = 'Successfully built abc123\nSuccessfully tagged test:latest';
            const connection = new MockContainerConnection(cleanOutput);

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.strictEqual(connection.stdoutWritten, cleanOutput,
                    "Clean output should pass through unmodified");
                done();
            }).catch(done);
        });

        it('Should leave ##VSO[ alone because the agent matches case-sensitively', (done) => {
            // The agent locates commands with
            // message.IndexOf("##vso[", StringComparison.Ordinal), so "##VSO["
            // is not a command and does not need neutralizing. Matching the
            // agent byte-for-byte avoids corrupting legitimate output that
            // merely looks like a marker.
            const connection = new MockContainerConnection("##VSO[task.prependpath]/tmp/pwned");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "no lowercase marker should be introduced");
                assert.ok(connection.stdoutWritten.includes("##VSO[task.prependpath]"),
                    "##VSO[ is inert to the agent and should pass through unchanged");
                done();
            }).catch(done);
        });

        it('Should allow the task-lib default allowlist through (task.debug)', (done) => {
            const connection = new MockContainerConnection("##vso[task.debug]hello");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(connection.stdoutWritten.includes("##vso[task.debug]"),
                    "allowlisted commands stay intact so benign tooling output is not broken");
                done();
            }).catch(done);
        });

        it('Should sanitize multiple ##vso[ commands in one output chunk', (done) => {
            const multiCommand = '##vso[task.prependpath]/a\nnormal line\n##vso[task.setvariable variable=x]y';
            const connection = new MockContainerConnection(multiCommand);

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "All ##vso[ instances should be sanitized");
                assert.ok(connection.stdoutWritten.includes("normal line"),
                    "Non-malicious output should be preserved");
                done();
            }).catch(done);
        });
    });

    describe('command()', () => {

        it('Should sanitize ##vso[ commands in stdout', (done) => {
            const connection = new MockContainerConnection("##vso[task.prependpath]/tmp/pwned");

            dockerCommandUtils.command(
                connection as any, "run", "malicious-image", (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "stdout should be sanitized");
                done();
            }).catch(done);
        });

        it('Should still provide raw output to the callback', (done) => {
            const maliciousOutput = '##vso[task.setvariable variable=SECRET]stolen';
            const connection = new MockContainerConnection(maliciousOutput);

            dockerCommandUtils.command(
                connection as any, "run", "image",
                (output) => {
                    assert.ok(output.includes("##vso[task.setvariable"),
                        "Raw callback should receive unsanitized data");
                }
            ).then(() => {
                done();
            }).catch(done);
        });
    });

    describe('push()', () => {

        it('Should sanitize ##vso[ commands in stdout', (done) => {
            const connection = new MockContainerConnection("##vso[task.prependpath]/tmp/evil");

            dockerCommandUtils.push(
                connection as any, "myimage:latest", "", (_image, _output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "stdout should be sanitized");
                done();
            }).catch(done);
        });

        it('Should still provide raw output to the callback', (done) => {
            const maliciousOutput = '##vso[task.prependpath]/tmp/evil';
            const connection = new MockContainerConnection(maliciousOutput);

            dockerCommandUtils.push(
                connection as any, "myimage:latest", "",
                (_image, output) => {
                    assert.ok(output.includes("##vso[task.prependpath]"),
                        "Raw callback should receive unsanitized data");
                }
            ).then(() => {
                done();
            }).catch(done);
        });
    });

    describe('start()', () => {

        it('Should sanitize ##vso[ commands in stdout', (done) => {
            const connection = new MockContainerConnection("##vso[task.prependpath]/tmp/evil");

            dockerCommandUtils.start(
                connection as any, "container-1", "", (_container, _output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "stdout should be sanitized");
                done();
            }).catch(done);
        });
    });

    describe('stop()', () => {

        it('Should sanitize ##vso[ commands in stdout', (done) => {
            const connection = new MockContainerConnection("##vso[task.prependpath]/tmp/evil");

            dockerCommandUtils.stop(
                connection as any, "container-1", "", (_container, _output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "stdout should be sanitized");
                done();
            }).catch(done);
        });
    });

    describe('chunk-split bypass prevention', () => {

        it('Should sanitize ##vso[ split across two chunks: "##vs" + "o[..."', (done) => {
            const connection = new MockContainerConnection();
            connection.mockToolRunner.simulatedStdoutChunks = [
                "some output ##vs",
                "o[task.prependpath]/tmp/pwned\n"
            ];

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "##vso[ split across chunks should still be sanitized");
                assert.ok(connection.stdoutWritten.includes("##_vso[task.prependpath]"),
                    "Sanitized marker should be present");
                done();
            }).catch(done);
        });

        it('Should sanitize ##vso[ split as "##" + "vso[..."', (done) => {
            const connection = new MockContainerConnection();
            connection.mockToolRunner.simulatedStdoutChunks = [
                "##",
                "vso[task.setvariable variable=x]y"
            ];

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "##vso[ split as ## + vso[ should be sanitized");
                done();
            }).catch(done);
        });

        it('Should sanitize ##vso[ split as "####vs" + "o[..." (marker after partial)', (done) => {
            const connection = new MockContainerConnection();
            connection.mockToolRunner.simulatedStdoutChunks = [
                "####vs",
                "o[task.prependpath]/tmp/pwned"
            ];

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "##vso[ preceded by extra # chars and split should be sanitized");
                done();
            }).catch(done);
        });

        it('Should handle three-way chunk split: "#" + "#vso" + "[..."', (done) => {
            const connection = new MockContainerConnection();
            connection.mockToolRunner.simulatedStdoutChunks = [
                "#",
                "#vso",
                "[task.prependpath]/tmp/pwned"
            ];

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "##vso[ split across three chunks should be sanitized");
                done();
            }).catch(done);
        });
    });

    describe('getHistory()', () => {

        it('Should pass sanitized exec options to execCommand', (done) => {
            const maliciousHistory = 'createdAt:2024-01-01; layerSize:0B; createdBy:##vso[task.prependpath]/tmp/pwned; layerId:sha256:abc';
            const connection = new MockContainerConnection(maliciousHistory);

            dockerCommandUtils.getHistory(
                connection as any, "myimage:latest"
            ).then(() => {
                assert.ok(connection.lastExecOptions, "execCommand should receive options");
                assert.ok(connection.lastExecOptions.externalOutput,
                    "options should enable ToolRunner external-output filtering");
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "getHistory stdout should be sanitized");
                done();
            }).catch(done);
        });
    });
}
