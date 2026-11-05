"use strict";

import * as tl from "azure-pipelines-task-lib/task";
import {
    filterExternalOutput,
    ExternalOutputOptions,
    VsoCommandMode
} from "azure-pipelines-task-lib/externaloutput";

/**
 * Pipeline feature gating the new Docker errline/pull/inspect sanitization
 * added to close the ##vso[] command-injection path from untrusted Docker
 * daemon stderr (see containerconnection.ts execCommand and
 * containerimageutils.ts runPullImageCommand/runInspectImageCommand).
 *
 * Rollout semantics (read via tl.getPipelineFeature, backed by the pipeline
 * variable "DistributedTask.Tasks.EnableDockerErrlineVsoCommandSanitization"):
 *   - off (default until rollout completes): raw errline/stderr is left
 *     completely unmodified, preserving pre-fix behavior for compatibility -
 *     a customer relying on a Docker-emitted ##vso[] command (e.g.
 *     task.setvariable from a wrapper script) is not broken by this change.
 *   - on: errline/stderr is neutralized (blockAndTelemetry) before it can
 *     reach the tl.error()/console.log()/tl.debug() replay sinks. Only
 *     task-lib's default allowlist (task.debug, task.setprogress) keeps
 *     working; every other command is escaped.
 *
 * Detection telemetry is handled natively by azure-pipelines-task-lib (>=5.281.2)'s
 * filterExternalOutput/MarkerFilter via the `vsoCommandMode` option below - every
 * "##vso[...]" command it encounters is reported (area=TaskLib,
 * feature=ExternalOutputVsoCommand) with {source, commandName, blocked}
 * regardless of enforcement, so we can measure real-world command
 * usage/prevalence (and therefore blast radius of turning enforcement on)
 * before ramping this flag. See
 * https://github.com/microsoft/azure-pipelines-tasks/pull/22551 for the
 * precedent (AzureContainerAppsV1, GitHubReleaseV1) this mirrors.
 */
export const DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE = "EnableDockerErrlineVsoCommandSanitization";

/**
 * Pipeline feature gating an additional, host-attributed trace event emitted whenever
 * sanitizeDockerErrlineForLog finds one or more non-allowlisted ##vso[] commands in Docker
 * output - i.e. commands that are (or, if enforcement is still off, that *would be*) blocked.
 *
 * This is deliberately independent of DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE
 * (enforcement) above, and independent of task-lib's own always-on detection telemetry:
 *   - Task-lib's telemetry answers "which commands appear in Docker output, in aggregate,
 *     across all orgs" but cannot be scoped to the Docker task specifically (no task-type
 *     column) and carries no host/organization identifier.
 *   - This flag answers "which specific host (organization/collection) is using a command
 *     that is/would be blocked in the Docker task, and which command", so individual
 *     customers can be identified, counted, and investigated.
 *
 * Because it does not depend on enforcement being on, this can (and should) be enabled first,
 * while enforcement is still off, to safely observe real-world impact ("collect data about
 * what commands are actually used, and trace them in telemetry" per PR #672 review feedback)
 * before ever flipping DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE on. The emitted payload's
 * `blocked` field reflects whether enforcement was actually on for that event, so detection-only
 * ("would be blocked") and enforced ("was blocked") events remain distinguishable in Kusto.
 *
 * Read via tl.getPipelineFeature, backed by the pipeline variable
 * "DistributedTask.Tasks.EnableDockerErrlineBlockedCommandHostTracing". Off by default -
 * enable only when actively measuring/tracking which hosts use commands that are or would be
 * blocked, since every such command on every affected host emits one event.
 */
export const DOCKER_ERRLINE_BLOCKED_COMMAND_HOST_TRACING_PIPELINE_FEATURE = "EnableDockerErrlineBlockedCommandHostTracing";

// The organization/collection identifier used elsewhere in this codebase (see
// azure-pipelines-tasks-utility-common/telemetry.ts's emitTelemetry) to attribute telemetry
// to a specific host. Stable per-organization, available to every task via the agent.
const HOST_ID_VARIABLE = "SYSTEM_COLLECTIONID";

// Used only to decide whether there is anything to do at all for host-tracing below.
// Intentionally not restricted to any command-name charset, so this decision does not depend
// on task-lib's current command-name parsing rules.
const VSO_COMMAND_PRESENCE_REGEX = /##vso\[/i;

// Used only to name detected commands for the host-tracing event below. This charset is a
// best-effort label and must NOT be used to decide whether blocking/telemetry should run -
// azure-pipelines-task-lib's own MarkerFilter is the source of truth for that.
const VSO_COMMAND_NAME_REGEX = /##vso\[([a-zA-Z0-9_.]+)/gi;

const DOCKER_ERRLINE_SANITIZER_TELEMETRY_AREA = "TaskHub";

// Mirrors azure-pipelines-task-lib's defaultAllowedVsoCommands (task.debug, task.setprogress),
// which remain usable even when enforcement is on (see dockerExternalOutputOptions below). Used
// only to compute which commands would actually be escaped, for the host-tracing event below.
const DEFAULT_ALLOWED_VSO_COMMANDS = new Set(["task.debug", "task.setprogress"]);

// For host-tracing labeling only - see comment on VSO_COMMAND_NAME_REGEX above.
function findVsoCommands(text: string): string[] {
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    const regex = new RegExp(VSO_COMMAND_NAME_REGEX);
    while ((match = regex.exec(text)) !== null) {
        found.add(match[1].toLowerCase());
    }
    return Array.from(found);
}

/**
 * Emits one host-attributed trace event per detected non-allowlisted command name. Gated by
 * DOCKER_ERRLINE_BLOCKED_COMMAND_HOST_TRACING_PIPELINE_FEATURE - see that constant's
 * comment for why this is separate from task-lib's always-on detection telemetry (which
 * cannot be scoped to a specific task type like Docker - see commandName/host cardinality
 * discussion below).
 *
 * `blocked` reflects whether DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE (enforcement) was
 * actually on for this event: false while only observing ("would be blocked"), true once
 * enforcement has been ramped. This lets the exact same query be used throughout the rollout.
 *
 * Deliberately one event per (command, host) pair rather than a single batched/comma-joined
 * event, so this is directly queryable in Kusto without string-splitting:
 *
 *   CustomerIntelligence
 *   | where TIMESTAMP >= ago(30d)
 *   | where Area == "TaskHub" and Feature == "Docker"
 *   | extend p = parse_json(Properties).properties
 *   | extend commandName = tostring(p.commandName), blocked = tobool(p.blocked)
 *   | summarize DistinctOrgs = dcount(HostId), TotalEvents = count() by commandName, blocked
 *   | order by DistinctOrgs desc
 *
 * This answers "which command is used/blocked in the Docker task, and by how many customers" -
 * exactly the metric task-lib's own area=TaskLib;feature=ExternalOutputVsoCommand telemetry
 * cannot provide, since it never identifies which task type (Docker vs. any other consumer
 * of vsoCommandMode) produced the event. To list the affected hostIds for a given command:
 *
 *   CustomerIntelligence
 *   | where TIMESTAMP >= ago(30d)
 *   | where Area == "TaskHub" and Feature == "Docker"
 *   | extend p = parse_json(Properties).properties
 *   | where tostring(p.commandName) == "task.setvariable"
 *   | distinct HostId
 *
 * The list of distinct hostIds/customers affected is obtained by aggregating these events in
 * the telemetry backend (e.g. Kusto) as shown above, not by accumulating state in-process - a
 * task's process is short-lived and does not persist across pipeline runs.
 */
function emitBlockedCommandHostTrace(feature: string, hostId: string, commandNames: string[], blocked: boolean): void {
    for (const commandName of commandNames) {
        try {
            const payload = {
                event: "DockerErrlineVsoCommandDetected",
                hostId: hostId,
                commandName: commandName,
                blocked: blocked
            };
            console.log(`##vso[telemetry.publish area=${DOCKER_ERRLINE_SANITIZER_TELEMETRY_AREA};feature=${feature}]${JSON.stringify(payload)}`);
        } catch (err) {
            tl.debug(`sanitizeDockerErrlineForLog: failed to emit host trace for ${commandName}: ${err}`);
        }
    }
}

/**
 * The external-output policy applied to everything Docker emits via ToolRunner/execCommand's
 * live stdout/stderr streaming (see createSanitizedExecOptions in dockercommandutils.ts).
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
 * every state-changing command remains blocked. This path predates and is
 * unaffected by DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE above (it is
 * unconditional, matching pre-existing behavior), so vsoCommandMode is left
 * at its default ('blockOnly' - block, no telemetry).
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

/**
 * The external-output policy for containerimageutils.ts's runPullImageCommand/
 * runInspectImageCommand execSync() call sites. Mirrors sanitizeDockerErrlineForLog's
 * enforcement gating (vsoCommandMode 'telemetryOnly' when off, 'blockAndTelemetry' when on)
 * so these call sites always receive *some* externalOutput policy - and therefore always get
 * task-lib's detection telemetry for their live stdout/stderr - instead of passing `undefined`
 * (no filtering, no telemetry at all) while enforcement is off. Without this, pull/inspect
 * would be the one surface in this package where real-world command usage could never be
 * measured before enforcement is turned on, defeating the "collect data first" rollout step.
 */
export function createDockerExecSyncOutputOptions(enforced: boolean): ExternalOutputOptions {
    return {
        source: "childProcess",
        enableVsoCommands: true,
        vsoCommandMode: enforced ? "blockAndTelemetry" : "telemetryOnly"
    };
}

/**
 * Preferred entry point for call sites (containerconnection.ts errline capture,
 * containerimageutils.ts pull/inspect stderr) - combines feature-gated enforcement with
 * task-lib's always-on detection telemetry, per PR feedback on PR #672:
 *
 *   "With current change the code will block anything except task.debug and
 *    task.setprogress. There might be cases when customers rely on other more
 *    important commands (such as task.setvariable). Restricting them might
 *    break processing of the whole pipeline [...] Put the change behind FF.
 *    Collect data about what commands (and how much) are actually used here
 *    and trace them in telemetry."
 *
 * Implementation follows the precedent set in
 * https://github.com/microsoft/azure-pipelines-tasks/pull/22551 (AzureContainerAppsV1,
 * GitHubReleaseV1): a single FF check picks azure-pipelines-task-lib's `vsoCommandMode`,
 * and task-lib's MarkerFilter does the actual byte-level blocking and telemetry - this
 * package no longer hand-rolls command detection/telemetry for that purpose.
 *
 * Behavior:
 *   - Feature off (default): vsoCommandMode='telemetryOnly' - `text` is returned
 *     completely unmodified, but task-lib still reports every detected "##vso[" command
 *     via telemetry (blocked=false), so real-world command usage can be measured before
 *     enforcement ramps.
 *   - Feature on: vsoCommandMode='blockAndTelemetry' - `text` is neutralized (escapes
 *     every "##vso[" command except task.debug/task.setprogress) and the same telemetry
 *     is emitted with blocked=true/false per command.
 *
 * Separately, whenever at least one non-allowlisted command is found and
 * DOCKER_ERRLINE_BLOCKED_COMMAND_HOST_TRACING_PIPELINE_FEATURE is enabled, a second,
 * host-attributed trace event is emitted carrying the host's SYSTEM_COLLECTIONID and the
 * specific command names - see emitBlockedCommandHostTrace. This check is intentionally
 * independent of enforcement (DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE): it can be
 * enabled first, while enforcement is still off, to identify exactly which customers/hosts
 * are using commands that would be blocked - the "collect data ... before enabling the FF"
 * step requested in PR #672 review feedback. The event's `blocked` field records whether
 * enforcement happened to be on for that event, so detection-only and enforced events stay
 * distinguishable in Kusto. This is distinct from task-lib's aggregate detection telemetry
 * above, which carries no host identifier.
 *
 * @param text the raw, untrusted Docker output line about to be replayed
 *        through tl.error()/console.log()/tl.debug().
 * @param telemetryFeature the `feature` tag used for the host-tracing event only
 *        (e.g. the calling task's name), so that usage can be attributed. Task-lib's own
 *        detection telemetry always uses its own fixed area/feature tags.
 * @param options.skipTaskLibTelemetry set by callers (containerimageutils.ts's
 *        pull/inspect) whose live stdout/stderr already passed through task-lib's
 *        MarkerFilter with telemetry enabled (see createDockerExecSyncOutputOptions).
 *        `text` there is the SAME underlying command output captured a second time
 *        (raw, for parsing), so leaving task-lib telemetry on here as well would
 *        double-count every detected command. Blocking/neutralization still follows
 *        the enforcement flag as usual; only task-lib's own detection telemetry is
 *        suppressed for this call. The independent host-tracing telemetry below
 *        (emitBlockedCommandHostTrace) is unaffected - it is never duplicated elsewhere.
 */
export function sanitizeDockerErrlineForLog(text: string, telemetryFeature: string, options?: { skipTaskLibTelemetry?: boolean }): string {
    if (!text) {
        return text;
    }

    const enforced = tl.getPipelineFeature(DOCKER_ERRLINE_SANITIZATION_PIPELINE_FEATURE);
    const vsoCommandMode: VsoCommandMode = options?.skipTaskLibTelemetry
        ? (enforced ? "blockOnly" : "disabled")
        : (enforced ? "blockAndTelemetry" : "telemetryOnly");

    const sanitized = filterExternalOutput(text, {
        source: "childProcess",
        enableVsoCommands: true,
        vsoCommandMode: vsoCommandMode
    }).toString("utf8");

    if (VSO_COMMAND_PRESENCE_REGEX.test(text)
        && tl.getPipelineFeature(DOCKER_ERRLINE_BLOCKED_COMMAND_HOST_TRACING_PIPELINE_FEATURE)) {
        const blockableCommands = findVsoCommands(text).filter(c => !DEFAULT_ALLOWED_VSO_COMMANDS.has(c));
        if (blockableCommands.length > 0) {
            const hostId = tl.getVariable(HOST_ID_VARIABLE) || "unknown";
            emitBlockedCommandHostTrace(telemetryFeature, hostId, blockableCommands, enforced);
        }
    }

    return sanitized;
}
