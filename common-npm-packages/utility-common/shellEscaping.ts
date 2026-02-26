function escapeForSingleQuotedShell(value: string): string {
    return value.replace(/'/g, "'\\''");
}

/**
 * @example
 * // Normal paths
 * shellQuote("/path/to/file with spaces")  // → "'/path/to/file with spaces'"
 * shellQuote("")                           // → "''"
 */
export function shellQuote(value: string | null | undefined): string {
    if (!value) return "''";
    const escaped = escapeForSingleQuotedShell(value);
    const result = "'" + escaped + "'";
    if (value.endsWith("'")) {
        return result + "'";
    }
    return result;
}

/**
 * @example
 * neutralizeCommandSubstitution("-DFOO=$(whoami)")    // → "-DFOO=\\$(whoami)"
 * neutralizeCommandSubstitution("-DFOO=`id`")         // → "-DFOO=\\`id\\`"
 * neutralizeCommandSubstitution("-DPATH=$HOME/bin")   // → "-DPATH=$HOME/bin" (preserved)
 * neutralizeCommandSubstitution("-DPATH=${HOME}/bin") // → "-DPATH=${HOME}/bin" (preserved)
 */
export function neutralizeCommandSubstitution(value: string | null | undefined): string | null | undefined {
    if (!value) return value;

    let result = value.replace(/\\/g, '\\\\');
    result = result.replace(/`/g, '\\`');
    result = result.replace(/\$\(/g, '\\$(');
    return result;
}

/**
 * Escapes ALL shell metacharacters in a string for safe use in unquoted shell
 * contexts. Preserves $VAR and ${VAR} environment variable references while
 * escaping every operator that could lead to command injection (CWE-78).
 *
 * Use this when single-quoting via shellQuote() is not suitable (e.g., when
 * environment variable expansion must be preserved by the shell).
 *
 * @example
 * escapeShellArg("file; rm -rf /")        // → "file\\; rm\\ -rf\\ /"
 * escapeShellArg("-DPATH=$HOME/bin")       // → "-DPATH=$HOME/bin" (preserved)
 * escapeShellArg("$(whoami)")              // → "\\$(whoami)"
 */
export function escapeShellArg(value: string | null | undefined): string | null | undefined {
    // TODO: implement — this is a TDD stub that will cause tests to fail
    if (!value) return value;
    return value;
}
