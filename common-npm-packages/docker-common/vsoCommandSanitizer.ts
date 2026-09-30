"use strict";

// Matches one or more # followed by vso[ — the prefix the Azure Pipelines agent
// uses to detect logging commands. We match #+ (not just ##) so that inputs
// like "####vso[" are fully neutralised in a single pass rather than leaving a
// residual "##vso[" after replacing the inner match.
// Case-insensitive because the agent accepts any casing.
//
// This is the single source of truth for the pattern: it is security-critical
// (it defines what the Azure Pipelines agent treats as a logging command), so
// it must not be duplicated - every sanitizer in this package should import
// it from here rather than re-declaring it.
export const vsoCommandPattern = /#+vso\[/gi;

/**
 * Strips ##vso[ command prefixes from a string so that the Azure Pipelines
 * agent does not interpret attacker-controlled Docker output as a logging
 * command (e.g. task.setvariable, task.prependpath).
 *
 * The replacement preserves the text for human readability while making it
 * invisible to the agent's command parser.
 *
 * This operates on a complete string only. Callers that receive output in
 * arbitrary chunks (e.g. a raw stdout/stderr stream, where a marker could be
 * split across two chunks) must additionally guard against that - see
 * dockercommandutils.ts's createSanitizedOutputStream, which carries over a
 * trailing partial marker across writes before delegating here.
 */
export function sanitizeVsoCommandMarkers(data: string): string {
    return data.replace(vsoCommandPattern, "#vso[");
}
