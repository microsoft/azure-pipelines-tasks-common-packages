"use strict";

import {
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
 * line). For streamed child-process output, pass dockerExternalOutputOptions
 * to ToolRunner's `externalOutput` option so ToolRunner owns both filtering
 * and finalization.
 */
export function sanitizeVsoCommandMarkers(data: string): string {
    return filterExternalOutput(data, dockerExternalOutputOptions).toString("utf8");
}
