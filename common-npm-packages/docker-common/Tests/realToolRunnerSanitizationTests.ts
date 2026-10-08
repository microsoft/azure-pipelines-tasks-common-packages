import assert = require("assert");
import * as os from "os";
import { PassThrough } from "stream";

// Set environment variables required by azure-pipelines-task-lib before importing it
process.env['INPUT_BUILDCONTEXT'] = '/tmp/build';
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = '/tmp/work';

import * as tl from "azure-pipelines-task-lib/task";
import * as tr from "azure-pipelines-task-lib/toolrunner";
import ContainerConnection from "../containerconnection";
import { dockerExternalOutputOptions } from "../vsoCommandSanitizer";

/**
 * These tests exercise the real azure-pipelines-task-lib ToolRunner (a real
 * child process, real OS pipes) instead of a mock, because a mock can hide
 * lifecycle and routing behavior:
 *
 *  - ToolRunner streams stdout/stderr as raw "data" chunks exactly as the
 *    pipe buffer delivers them, so a "##vso[" marker can legitimately arrive
 *    split across two chunks.
 *  - ToolRunner owns and finalizes the writers created for `externalOutput`,
 *    so trailing output is flushed even though shared display streams remain
 *    open for later commands.
 */
export function runRealToolRunnerSanitizationTests() {

    function captureStream(): { stream: NodeJS.WritableStream; chunks: Buffer[] } {
        const chunks: Buffer[] = [];
        const stream = new PassThrough();
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        return { stream, chunks };
    }

    describe('ContainerConnection.execCommand() with a real ToolRunner child process', () => {

        function getChildOutput(chunks: Buffer[]): string {
            const output = Buffer.concat(chunks).toString("utf8");
            const commandLineEnd = output.indexOf(os.EOL);
            assert.ok(commandLineEnd >= 0, "ToolRunner should emit its command line first");
            return output.substring(commandLineEnd + os.EOL.length);
        }

        it('sanitizes a split ##vso[ header when ToolRunner routes stderr to outStream', (done) => {
            const connection = new ContainerConnection(false);
            const command = tl.tool(process.execPath);
            command.arg(["-e",
                "process.stderr.write('##vs');" +
                "setTimeout(() => {" +
                " process.stderr.write('o[task.setvariable variable=BASH_ENV]/tmp/evil.sh\\n'," +
                " () => process.stdout.end());" +
                "}, 50);"
            ]);

            const out = captureStream();
            const err = captureStream();
            const options: tr.IExecOptions = {
                outStream: out.stream,
                errStream: err.stream,
                externalOutput: dockerExternalOutputOptions
            };

            connection.execCommand(command, options).then(() => {
                assert.strictEqual(
                    getChildOutput(out.chunks),
                    "##_vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh\n" + os.EOL,
                    "the split marker and ToolRunner's trailing newline should be preserved exactly"
                );
                assert.strictEqual(Buffer.concat(err.chunks).toString("utf8"), "",
                    "ToolRunner should route stderr to outStream unless failOnStdErr is set");
                done();
            }).catch(done);
        });

        it('flushes a trailing marker fragment left unterminated when the process exits mid-header', (done) => {
            const connection = new ContainerConnection(false);
            const command = tl.tool(process.execPath);
            // No failOnStdErr: matches docker-common's actual configuration, so
            // this fragment streams through outStream, and the command is
            // expected to succeed (writing to stderr alone does not fail it).
            command.arg(["-e",
                "process.stderr.write('partial output ##vs', () => process.stdout.end());"
            ]);

            const out = captureStream();
            const err = captureStream();
            const options: tr.IExecOptions = {
                outStream: out.stream,
                errStream: err.stream,
                externalOutput: dockerExternalOutputOptions
            };

            connection.execCommand(command, options).then(() => {
                assert.strictEqual(
                    getChildOutput(out.chunks),
                    "partial output ##vs" + os.EOL,
                    "ToolRunner finalization must flush an unterminated marker fragment to outStream, " +
                    "with the trailing newline ToolRunner appends"
                );
                assert.strictEqual(Buffer.concat(err.chunks).toString("utf8"), "",
                    "ToolRunner should route stderr to outStream unless failOnStdErr is set");
                done();
            }).catch(done);
        });

        it('preserves full output, including the trailing newline ToolRunner appends on stdout', (done) => {
            const connection = new ContainerConnection(false);
            const command = tl.tool(process.execPath);
            command.arg(["-e", "process.stdout.write('line one\\nline two')"]);

            const out = captureStream();
            const err = captureStream();
            const options: tr.IExecOptions = {
                outStream: out.stream,
                errStream: err.stream,
                externalOutput: dockerExternalOutputOptions
            };

            connection.execCommand(command, options).then(() => {
                assert.strictEqual(
                    getChildOutput(out.chunks),
                    "line one\nline two" + os.EOL,
                    "ToolRunner should preserve the full child output and append exactly one trailing newline"
                );
                done();
            }).catch(done);
        });
    });

    describe('ToolRunner.execSync() with createSanitizedExecOptions() (containerimageutils pull/inspect path)', () => {

        it('sanitizes the live-logged copy but returns raw stdout/stderr to the caller', () => {
            const command = tl.tool(process.execPath);
            command.arg(["-e",
                "process.stdout.write('{\"RepoDigests\":[\"img@sha256:abc\"]}');" +
                "process.stderr.write('##vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh');"
            ]);

            const out = captureStream();
            const err = captureStream();
            const result = command.execSync({
                outStream: out.stream,
                errStream: err.stream,
                externalOutput: dockerExternalOutputOptions
            } as tr.IExecOptions);

            // The live log must never see the raw marker - this is what
            // runPullImageCommand()/runInspectImageCommand() rely on.
            assert.ok(!Buffer.concat(out.chunks).toString("utf8").includes("##vso["),
                "stdout copy written to the live log must be sanitized");
            assert.ok(!Buffer.concat(err.chunks).toString("utf8").includes("##vso["),
                "stderr copy written to the live log must be sanitized");

            // The value handed back to the caller must stay byte-for-byte raw,
            // since runInspectImageCommand() JSON.parse()s it directly.
            assert.strictEqual(result.stdout, '{"RepoDigests":["img@sha256:abc"]}',
                "execSync() must return raw stdout so JSON.parse() keeps working");
            assert.strictEqual(result.stderr, "##vso[task.setvariable variable=BASH_ENV]/tmp/evil.sh",
                "execSync() must return raw stderr for callers that need to inspect/log it themselves");
            assert.deepStrictEqual(JSON.parse(result.stdout), { RepoDigests: ["img@sha256:abc"] },
                "the raw stdout returned by execSync() must remain valid JSON");
        });
    });
}
