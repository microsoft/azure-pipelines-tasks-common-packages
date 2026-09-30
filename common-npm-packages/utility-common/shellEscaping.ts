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
 *
 * NOTE: This function deliberately preserves shell variable expansion ($VAR and
 * ${VAR}) and therefore does NOT neutralize brace expansion ({a,b} / {1..5}),
 * pathname globbing (* ? [ ]) or tilde expansion (~). For example bash expands
 * an unquoted multi-key JSON value '{"a":"b","c":"d"}' via brace expansion into
 * two words, corrupting the value. When the argument is fully untrusted and no
 * variable expansion is required (e.g. an Ansible --extra-vars JSON blob), wrap
 * each token with shellQuote() instead — single quoting keeps the value intact
 * and inert against every form of shell interpretation.
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
 * Removes one level of POSIX shell quoting from a single, already-tokenized
 * argument, honouring quote context so that quote characters nested inside a
 * different quoting style survive as literals.
 *
 * Unlike a sequence of independent global regex replacements, this is a single
 * left-to-right pass, so the double quotes inside a single-quoted JSON value are
 * preserved: removeShellQuoting(`'{"a":"b"}'`) === `{"a":"b"}`.
 *
 * Rules (matching /bin/sh):
 * - Single quotes '...'  : every character is literal until the next single quote.
 * - Double quotes "..."  : a backslash only escapes $ ` " \ and newline; every
 *                          other character (including ') is literal.
 * - Unquoted backslash   : escapes the following character.
 */
function removeShellQuoting(raw: string): string {
    let result = '';
    let i = 0;

    while (i < raw.length) {
        const ch = raw[i];

        if (ch === "'") {
            i++;
            while (i < raw.length && raw[i] !== "'") {
                result += raw[i++];
            }
            i++; // consume the closing quote (if present)
        } else if (ch === '"') {
            i++;
            while (i < raw.length && raw[i] !== '"') {
                if (raw[i] === '\\' && i + 1 < raw.length && '$`"\\\n'.indexOf(raw[i + 1]) !== -1) {
                    result += raw[i + 1];
                    i += 2;
                } else {
                    result += raw[i++];
                }
            }
            i++; // consume the closing quote (if present)
        } else if (ch === '\\') {
            if (i + 1 < raw.length) {
                result += raw[i + 1];
                i += 2;
            } else {
                i++;
            }
        } else {
            result += raw[i++];
        }
    }

    return result;
}

/**
 * @example
 * shellSplit('-DFOO=bar -DBAZ="hello world"')
 * // → ['-DFOO=bar', '-DBAZ=hello world']
 *
 * shellSplit("-DPATH='/usr/local/my app' -DVER=1.0")
 * // → ['-DPATH=/usr/local/my app', '-DVER=1.0']
 *
 * shellSplit(`--extra-vars '{"a":"b"}'`)
 * // → ['--extra-vars', '{"a":"b"}']   (nested double quotes preserved)
 *
 * // Safe workflow for fully-untrusted, multi-param inputs — re-quote every token
 * // so the shell treats each one as a single, literal argument:
 * shellSplit(args).map(shellQuote).join(' ')
 *
 * // Use .map(neutralizeCommandSubstitution) instead only when shell variable
 * // expansion ($VAR/${VAR}) must be preserved AND the input cannot contain
 * // brace/glob/tilde metacharacters (see neutralizeCommandSubstitution notes).
 */
export function shellSplit(value: string | null | undefined): string[] {
    if (!value) return [];

    const tokenRegex = /(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\]+)+/g;

    const tokens: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(value)) !== null) {
        tokens.push(removeShellQuoting(match[0]));
    }

    return tokens;
}
