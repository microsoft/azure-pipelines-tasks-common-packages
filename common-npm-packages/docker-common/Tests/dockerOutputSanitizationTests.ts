import assert = require("assert");
import { EventEmitter } from "events";
import { Writable } from "stream";

// Set environment variables required by azure-pipelines-task-lib before importing dockerCommandUtils
process.env['INPUT_BUILDCONTEXT'] = '/tmp/build';
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = '/tmp/work';

import * as dockerCommandUtils from "../dockercommandutils";

/**
 * Minimal mock for ToolRunner that simulates Docker command execution.
 * When exec() is called, it emits stdout/stderr data and writes to the
 * provided outStream/errStream options, mimicking real ToolRunner behavior.
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

        return new Promise<void>((resolve) => {
            const writes: Promise<void>[] = [];

            if (this.simulatedStdoutChunks && options && options.outStream) {
                // Write as multiple chunks to simulate pipe buffer splits
                let chain = Promise.resolve();
                for (const chunk of this.simulatedStdoutChunks) {
                    chain = chain.then(() => new Promise<void>((res) => {
                        options.outStream.write(chunk, 'utf8', () => res());
                    }));
                }
                writes.push(chain);
            } else if (this.simulatedStdout && options && options.outStream) {
                writes.push(new Promise<void>((res) => {
                    options.outStream.write(this.simulatedStdout, 'utf8', () => res());
                }));
            }
            if (this.simulatedStderr && options && options.errStream) {
                writes.push(new Promise<void>((res) => {
                    options.errStream.write(this.simulatedStderr, 'utf8', () => res());
                }));
            }

            Promise.all(writes).then(() => {
                // Signal end to flush any stateful carry-over in the sanitized stream
                if (options && options.outStream && typeof options.outStream.end === 'function') {
                    options.outStream.end(() => resolve());
                } else {
                    resolve();
                }
            });
        });
    }
}

/**
 * Mock ContainerConnection that uses MockToolRunner.
 * Captures exec options and intercepts what the sanitized outStream/errStream
 * writes to process.stdout/stderr during exec.
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

        it('Should pass outStream and errStream options to execCommand', (done) => {
            const connection = new MockContainerConnection("output");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(connection.lastExecOptions, "execCommand should receive options");
                assert.ok(connection.lastExecOptions.outStream, "options should have outStream");
                assert.ok(connection.lastExecOptions.errStream, "options should have errStream");
                done();
            }).catch(done);
        });

        it('Should not use raw process.stdout as outStream', (done) => {
            const connection = new MockContainerConnection("output");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.notStrictEqual(connection.lastExecOptions.outStream, process.stdout,
                    "outStream must be a sanitizing wrapper, not raw process.stdout");
                assert.notStrictEqual(connection.lastExecOptions.errStream, process.stderr,
                    "errStream must be a sanitizing wrapper, not raw process.stderr");
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
                assert.ok(connection.stdoutWritten.includes("#vso[task.prependpath]"),
                    "Sanitized text should still be readable");
                done();
            }).catch(done);
        });

        it('Should sanitize ##vso[ on stderr (BuildKit scenario)', (done) => {
            const connection = new MockContainerConnection("", "##vso[task.setvariable variable=x]y");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stderrWritten.includes("##vso["),
                    "##vso[ should be sanitized on stderr too");
                assert.ok(connection.stderrWritten.includes("#vso[task.setvariable"),
                    "Sanitized command should still appear in stderr");
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

        it('Should handle case-insensitive ##VSO[ variants', (done) => {
            const connection = new MockContainerConnection("##VSO[task.prependpath]/tmp/pwned");

            dockerCommandUtils.build(
                connection as any, "Dockerfile", "", [], ["test:latest"], (_output) => {}
            ).then(() => {
                assert.ok(!connection.stdoutWritten.includes("##VSO["),
                    "Case-insensitive ##VSO[ should be sanitized");
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
                assert.ok(connection.stdoutWritten.includes("#vso[task.prependpath]"),
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
                assert.ok(connection.lastExecOptions.outStream, "options should have outStream");
                assert.ok(connection.lastExecOptions.errStream, "options should have errStream");
                assert.ok(!connection.stdoutWritten.includes("##vso["),
                    "getHistory stdout should be sanitized");
                done();
            }).catch(done);
        });
    });
}
