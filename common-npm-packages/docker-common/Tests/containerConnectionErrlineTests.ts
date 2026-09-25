import assert = require("assert");
import { EventEmitter } from "events";
import * as Q from "q";

// Set environment variables required by azure-pipelines-task-lib before importing it
process.env['INPUT_BUILDCONTEXT'] = '/tmp/build';
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = '/tmp/work';

import * as tl from "azure-pipelines-task-lib/task";
import ContainerConnection from "../containerconnection";

/**
 * Minimal mock for ToolRunner that simulates a Docker command emitting
 * "errline" events (as ToolRunner does for each stderr line) and then either
 * succeeding or failing, mirroring what ContainerConnection.execCommand()
 * actually observes from a real docker invocation.
 */
class MockToolRunner extends EventEmitter {
    public errlinesToEmit: string[] = [];
    public shouldFail: boolean = true;

    arg(_val: string | string[]): void { }
    line(_val: string): void { }

    exec(_options?: any): Q.Promise<void> {
        // Real ToolRunner emits "errline" as stderr data streams in, before the
        // process exit is known - replicate that ordering here.
        this.errlinesToEmit.forEach(line => this.emit("errline", line));

        return this.shouldFail
            ? Q.reject(new Error("docker exited with a non-zero status"))
            : Q.resolve(undefined);
    }
}

export function runContainerConnectionErrlineTests() {

    describe('ContainerConnection.execCommand() errline handling', () => {

        let originalError: typeof tl.error;
        let originalGetPipelineFeature: typeof tl.getPipelineFeature;
        let errorCalls: string[];

        beforeEach(() => {
            errorCalls = [];
            originalError = tl.error;
            // tl.error() is the agent-command-aware channel that replayed
            // errlines are ultimately written to on failure - capture what it
            // actually receives.
            (tl as any).error = (message: string) => { errorCalls.push(message); };

            originalGetPipelineFeature = tl.getPipelineFeature;
            // execCommand() branches to console.log('##[error]...') instead of
            // tl.error() when this feature is on. These tests target the
            // tl.error() path specifically, so force the flag off - otherwise
            // the assertions below would depend on whatever this flag happens
            // to be set to in the ambient environment the suite runs in (e.g.
            // a real Azure Pipelines CI agent may have it on by default),
            // which is exactly what caused these tests to fail in CI while
            // passing locally.
            (tl as any).getPipelineFeature = (featureName: string) =>
                featureName === "hideDockerExecTaskLogIssueErrorOutput" ? false : originalGetPipelineFeature(featureName);
        });

        afterEach(() => {
            (tl as any).error = originalError;
            (tl as any).getPipelineFeature = originalGetPipelineFeature;
        });

        it('sanitizes a ##vso[] marker replayed from stderr after a nonzero exit', (done) => {
            const connection = new ContainerConnection(false);
            const command = new MockToolRunner();
            command.errlinesToEmit = ["##vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh"];

            connection.execCommand(command as any).then(
                () => {
                    done(new Error("execCommand should have failed for a nonzero exit"));
                },
                () => {
                    try {
                        assert.strictEqual(errorCalls.length, 1,
                            "tl.error should be called once for the replayed errline");
                        assert.ok(!errorCalls[0].includes("##vso["),
                            "the replayed errline must not contain an unneutralized ##vso[ marker - " +
                            "this is the logging-command injection bypass: attacker-controlled Docker " +
                            "stderr on a failed command must not reach tl.error() unsanitized");
                        assert.ok(errorCalls[0].includes("#vso[task.setvariable"),
                            "the sanitized marker should still be present so the output stays readable");
                        done();
                    } catch (assertionError) {
                        done(assertionError);
                    }
                }
            );
        });

        it('does not alter clean error output', (done) => {
            const connection = new ContainerConnection(false);
            const command = new MockToolRunner();
            command.errlinesToEmit = ["docker: image not found"];

            connection.execCommand(command as any).then(
                () => done(new Error("execCommand should have failed for a nonzero exit")),
                () => {
                    try {
                        assert.deepStrictEqual(errorCalls, ["docker: image not found"],
                            "non-malicious error output should pass through unmodified");
                        done();
                    } catch (assertionError) {
                        done(assertionError);
                    }
                }
            );
        });

        it('sanitizes multiple replayed errlines independently, including split-hash variants', (done) => {
            const connection = new ContainerConnection(false);
            const command = new MockToolRunner();
            command.errlinesToEmit = [
                "normal error line",
                "##vso[task.setvariable variable=X]y",
                "####vso[task.prependpath]/tmp/evil"
            ];

            connection.execCommand(command as any).then(
                () => done(new Error("execCommand should have failed for a nonzero exit")),
                () => {
                    try {
                        assert.strictEqual(errorCalls.length, 3);
                        errorCalls.forEach(line => {
                            assert.ok(!line.includes("##vso["), `replayed line must not contain ##vso[: ${line}`);
                        });
                        assert.strictEqual(errorCalls[0], "normal error line");
                        done();
                    } catch (assertionError) {
                        done(assertionError);
                    }
                }
            );
        });

        it('does not replay anything when the command succeeds', (done) => {
            const connection = new ContainerConnection(false);
            const command = new MockToolRunner();
            command.shouldFail = false;
            command.errlinesToEmit = ["##vso[task.setvariable variable=X]y"];

            connection.execCommand(command as any).then(
                () => {
                    try {
                        assert.strictEqual(errorCalls.length, 0,
                            "errlines are only replayed through tl.error() on failure");
                        done();
                    } catch (assertionError) {
                        done(assertionError);
                    }
                },
                (err) => done(err)
            );
        });

        it('sanitizes the marker on the console.log path used when hideDockerExecTaskLogIssueErrorOutput is on', (done) => {
            const originalGetPipelineFeature = tl.getPipelineFeature;
            const originalConsoleLog = console.log;
            const consoleLogCalls: string[] = [];

            (tl as any).getPipelineFeature = (featureName: string) =>
                featureName === "hideDockerExecTaskLogIssueErrorOutput" ? true : false;
            console.log = (message?: any) => { consoleLogCalls.push(String(message)); };

            const restore = () => {
                (tl as any).getPipelineFeature = originalGetPipelineFeature;
                console.log = originalConsoleLog;
            };

            const connection = new ContainerConnection(false);
            const command = new MockToolRunner();
            command.errlinesToEmit = ["##vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh"];

            connection.execCommand(command as any).then(
                () => {
                    restore();
                    done(new Error("execCommand should have failed for a nonzero exit"));
                },
                () => {
                    try {
                        assert.strictEqual(consoleLogCalls.length, 1);
                        assert.ok(!consoleLogCalls[0].includes("##vso["),
                            "the console.log replay path must also be sanitized, not just tl.error()");
                        assert.ok(consoleLogCalls[0].includes("#vso[task.setvariable"),
                            "sanitized marker should still be present in the ##[error] line");
                        assert.strictEqual(errorCalls.length, 0,
                            "tl.error() should not be used when hideDockerExecTaskLogIssueErrorOutput is on");
                        restore();
                        done();
                    } catch (assertionError) {
                        restore();
                        done(assertionError);
                    }
                }
            );
        });
    });
}
