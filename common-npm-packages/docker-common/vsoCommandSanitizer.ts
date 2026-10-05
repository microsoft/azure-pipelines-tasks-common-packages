"use strict";

import { Writable } from "stream";
import {
    createFilteredWriter,
    filterExternalOutput,
    ExternalOutputOptions
} from "azure-pipelines-task-lib/externaloutput";

/**
 * The external-output policy applied to everything Docker emits.
 *
 * Docker output is untrusted: a remote Docker Engine can place arbitrary text
 * on stdout/stderr, so it must never be parsed by the agent as a logging
 * command (e.g. task.setvariable, task.prependpath).
 *
 * We deliberately reuse azure-pipelines-task-lib's external-output filtering
 * rather than matching markers ourselves. It is the platform's own definition
 * of what the agent treats as a command, it is byte-level and stateful (so a
 * marker split across chunks cannot slip through), and it neutralizes to the
 * same "##_vso[" form used elsewhere in the product.
 *
 * `enableVsoCommands` keeps task-lib's default allowlist
 * (`defaultAllowedVsoCommands`: task.debug and task.setprogress) working, so
 * benign progress/debug output from tooling is not silently dropped, while
 * every state-changing command remains blocked.
 */
export const dockerExternalOutputOptions: ExternalOutputOptions = {
    source: "childProcess",
    enableVsoCommands: true
};

/**
 * Neutralizes logging-command markers in a complete string of Docker output.
 *
 * Use this for values that are already whole (e.g. a single captured stderr
 * line). For output arriving in arbitrary chunks, use
 * createSanitizedOutputStream() instead, which keeps filter state across
 * writes so a marker cannot be split across a chunk boundary.
 */
export function sanitizeVsoCommandMarkers(data: string): string {
    return filterExternalOutput(data, dockerExternalOutputOptions).toString("utf8");
}

/**
 * Creates a stream that neutralizes logging-command markers in Docker output
 * before forwarding it to `destination`, so the output stays visible in the
 * build log but cannot inject agent commands.
 *
 * task-lib's filter is byte-level and stateful, so a marker split across
 * pipe-buffer chunks (e.g. "##vs" + "o[...") is still caught, and multibyte
 * UTF-8 sequences split across chunks are preserved.
 *
 * We wrap createFilteredWriter() in a Writable rather than using
 * createExternalOutputStream() because ToolRunner expects a Writable and
 * relies on the write callback. createFilteredWriter() forwards to the
 * destination synchronously, so the callback only fires once the filtered
 * bytes have actually been handed to `destination`; a piped Transform would
 * instead signal completion as soon as the chunk was accepted.
 */
export function createSanitizedOutputStream(destination: NodeJS.WritableStream): NodeJS.WritableStream {
    const writer = createFilteredWriter(dockerExternalOutputOptions, destination);

    return new Writable({
        write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
            try {
                writer.write(chunk);
                callback();
            } catch (err) {
                callback(err as Error);
            }
        },
        final(callback: (error?: Error | null) => void): void {
            try {
                writer.end();
                callback();
            } catch (err) {
                callback(err as Error);
            }
        }
    });
}
