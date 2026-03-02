function escapeForSingleQuotedShell(value: string): string {
    return value.replace(/'/g, "'\\''");
}

/**
 * Wraps a value in POSIX single quotes, escaping any embedded single quotes.
 * Safe for use as a single token in sh/bash command lines.
 * @example
 * shellQuote("/path/to/file with spaces")  // → "'/path/to/file with spaces'"
 * shellQuote("it's here")                  // → "'it'\\''s here'"
 * shellQuote("")                           // → "''"
 */
export function shellQuote(value: string | null | undefined): string {
    if (!value) return "''";
    const escaped = escapeForSingleQuotedShell(value);
    return "'" + escaped + "'";
}

/**
 * Escapes shell meta-characters that enable command substitution and chaining,
 * while preserving environment variable references ($VAR and ${VAR}).
 *
 * @example
 * neutralizeCommandSubstitution("-DFOO=$(whoami)")    // → "-DFOO=\\$(whoami\\)"
 * neutralizeCommandSubstitution("-DFOO=`id`")         // → "-DFOO=\\`id\\`"
 * neutralizeCommandSubstitution("-DPATH=$HOME/bin")   // → "-DPATH=$HOME/bin" (preserved)
 * neutralizeCommandSubstitution("-DPATH=${HOME}/bin") // → "-DPATH=${HOME}/bin" (preserved)
 * neutralizeCommandSubstitution("test;whoami")        // → "test\\;whoami"
 * neutralizeCommandSubstitution("test|curl evil.com") // → "test\\|curl evil.com"
 */
export function neutralizeCommandSubstitution(value: string | null | undefined): string | null | undefined {
    if (!value) return value;

    return value.replace(/\\|`|\$\(|;|\r\n|\r|\n|\||<|>|&|\(|\)|#/g, (match) => {
        switch (match) {
            case '\\': return '\\\\';
            case '`': return '\\`';
            case '$(': return '\\$(';
            case ';': return '\\;';
            case '\n': return '';
            case '\r\n': return '';
            case '\r': return '';
            case '|': return '\\|';
            case '<': return '\\<';
            case '>': return '\\>';
            case '&': return '\\&';
            case '(': return '\\(';
            case ')': return '\\)';
            case '#': return '\\#';
            default: return match;
        }
    });
}
