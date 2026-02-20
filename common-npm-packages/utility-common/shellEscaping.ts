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
