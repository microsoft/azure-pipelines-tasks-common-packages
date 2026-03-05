/**
 * Shell escaping utilities for Azure Pipelines tasks (CWE-78).
 *
 * Two complementary functions are provided. Choose based on your needs:
 *
 * ┌──────────────────────────────────┬───────────────┬───────────────────────────────┐
 * │ Function                         │ $VAR expands? │ How to use the output         │
 * ├──────────────────────────────────┼───────────────┼───────────────────────────────┤
 * │ shellQuote(input)                │ ❌ No         │ Use AS-IS — DO NOT add quotes │
 * │ neutralizeCommandSubstitution()  │ ✅ Yes        │ Use AS-IS — DO NOT add quotes │
 * └──────────────────────────────────┴───────────────┴───────────────────────────────┘
 *
 * IMPORTANT:
 * - These functions are for `sh -c` / bash execution ONLY.
 *   If you pass args via execFile/spawn (no shell), do NOT escape — the values
 *   go directly to the process and backslashes would be seen as literal characters.
 * - Do NOT compose these two functions (e.g. shellQuote(neutralize(x))).
 *   Each produces output for a specific shell context; combining them corrupts values.
 * - $VAR and ${VAR} expansion is impossible inside single quotes — this is a
 *   fundamental POSIX shell rule. If you need variable expansion, use
 *   neutralizeCommandSubstitution which works in an unquoted context.
 */

// ---------------------------------------------------------------------------
// shellQuote — POSIX single-quoting (no variable expansion)
// ---------------------------------------------------------------------------

/**
 * Wraps a value in POSIX single quotes, escaping any embedded single quotes.
 * Returns a complete, self-contained shell token. The caller must NOT add
 * additional quotes around the return value.
 *
 * Inside single quotes the shell treats every character as literal — no variable
 * expansion, no command substitution, no globbing. The only character that needs
 * handling is the single quote itself, which is escaped using the standard
 * end-quote / escaped-quote / start-quote idiom: ' → '\''
 *
 * When to use:
 *   ✅ You want the program to receive the EXACT string (no expansion at all)
 *   ✅ Building a shell command where the argument must be a single token
 *   ❌ You need $VAR or ${VAR} to expand (use neutralizeCommandSubstitution instead)
 *
 * @example
 *   // Developer builds a command string:
 *   const cmd = `cmake ${shellQuote(userInput)}`;
 *   // For userInput = "it's here"  → cmd = "cmake 'it'\\''s here'"
 *   // For userInput = "$(whoami)"  → cmd = "cmake '$(whoami)'"   (literal, not executed)
 *   // For userInput = "$HOME/bin"  → cmd = "cmake '$HOME/bin'"   ($HOME is NOT expanded)
 */
export function shellQuote(value: string | null | undefined): string {
    if (!value) return "''";
    const escaped = value.replace(/'/g, "'\\''");
    return "'" + escaped + "'";
}

// ---------------------------------------------------------------------------
// neutralizeCommandSubstitution — backslash-escaping (preserves $VAR expansion)
// ---------------------------------------------------------------------------

/** Shell metacharacters that are neutralized by prepending a backslash. */
const SHELL_META_CHARS = new Set([
    '\\', '`', ';', '|', '<', '>', '&', '(', ')', '#',
    "'", '"', ' ', '\t',
]);

/**
 * Escapes shell metacharacters in a value so it can be safely placed in an
 * UNQUOTED shell context. Environment variable references ($VAR and ${VAR})
 * are intentionally preserved and will expand at runtime.
 *
 * The output is a self-contained shell token. The caller must NOT wrap it in
 * additional quotes — doing so would make the backslashes visible to the
 * receiving program (single quotes make everything literal, including '\').
 *
 * When to use:
 *   ✅ You need $VAR / ${VAR} to expand at shell runtime
 *   ✅ Building a shell command where the argument may reference env vars
 *   ❌ You want NO expansion at all (use shellQuote instead)
 *
 * What is escaped:
 *   - Command substitution: $( ) and backticks
 *   - Command chaining / piping: ; | & && ||
 *   - Redirects: < >
 *   - Comments: #
 *   - Quoting characters: ' " (prevents quote-breakout attacks)
 *   - Whitespace: space and tab (keeps value as a single argument)
 *   - Backslash: \ (prevents consuming escape sequences)
 *   - Parentheses: ( ) (prevents subshell creation)
 *   - Newlines: \n \r \r\n are stripped (they act as command separators)
 *
 * What is preserved:
 *   - $VAR and ${VAR} environment variable references
 *   - All other characters (letters, digits, punctuation like / . - _ = : @)
 *
 * Usage with a SINGLE value (one argument):
 * @example
 *   const cmd = `cmake -DPREFIX=${neutralizeCommandSubstitution(userValue)}`;
 *   // userValue = "$HOME/bin"     → cmd = "cmake -DPREFIX=$HOME/bin"      ($HOME expands ✅)
 *   // userValue = "$(whoami)"     → cmd = "cmake -DPREFIX=\$\(whoami\)"   (blocked ✅)
 *   // userValue = "'; rm -rf / #" → cmd = "cmake -DPREFIX=\'\;\ rm\..." (blocked ✅)
 *
 * Usage with MULTIPLE parameters (space-separated argument string):
 *   Spaces are escaped to keep each value as a single token, so a multi-param
 *   string would be collapsed into one argument. To preserve argument boundaries,
 *   split the string first and neutralize each part individually:
 * @example
 *   // ❌ WRONG — entire string becomes one argument:
 *   const cmd = `program ${neutralizeCommandSubstitution("-user abcd -authType Cert")}`;
 *   // → "program -user\ abcd\ -authType\ Cert"  (1 arg instead of 4)
 *
 *   // ✅ CORRECT — use shellSplit to respect quoted values, then neutralize each:
 *   const params = shellSplit(userInput).map(p => neutralizeCommandSubstitution(p)).join(' ');
 *   const cmd = `program ${params}`;
 *   // For "-user abcd -msg 'hello world'"
 *   //   shellSplit → ["-user", "abcd", "-msg", "hello world"]
 *   //   neutralize each → ["-user", "abcd", "-msg", "hello\ world"]
 *   //   join → "-user abcd -msg hello\ world"  (4 args, space in value preserved ✅)
 */
export function neutralizeCommandSubstitution(value: string | null | undefined): string | null | undefined {
    if (!value) return value;

    return value.replace(/\\|`|\$\(|;|\r\n|\r|\n|\||<|>|&|\(|\)|#|'|"| |\t/g, (match) => {
        if (match === '$(') return '\\$\\(';
        if (match === '\r\n' || match === '\r' || match === '\n') return '';
        if (SHELL_META_CHARS.has(match)) return '\\' + match;
        return match;
    });
}

// ---------------------------------------------------------------------------
// shellSplit — quote-aware argument splitting
// ---------------------------------------------------------------------------

/**
 * Splits a string into shell-style tokens, respecting single and double quotes.
 * Quoted segments have their quotes stripped — the content is returned as-is,
 * just like the shell would pass it to a program.
 *
 * Use this before neutralizeCommandSubstitution when the user provides a
 * multi-parameter string where values may contain spaces inside quotes.
 *
 * @example
 *   shellSplit("-user abcd -authType Cert")
 *   // → ["-user", "abcd", "-authType", "Cert"]
 *
 *   shellSplit("-msg 'hello world' -flag true")
 *   // → ["-msg", "hello world", "-flag", "true"]
 *
 *   shellSplit('-path "/opt/my dir/bin"')
 *   // → ["-path", "/opt/my dir/bin"]
 *
 *   // Combined with neutralize for safe multi-param handling:
 *   const safe = shellSplit(userInput).map(p => neutralizeCommandSubstitution(p)).join(' ');
 */
export function shellSplit(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inToken = false;
    let i = 0;

    while (i < input.length) {
        const ch = input[i];

        if (ch === "'") {
            // Single-quoted segment: consume until closing quote
            inToken = true;
            i++;
            while (i < input.length && input[i] !== "'") {
                current += input[i];
                i++;
            }
            i++; // skip closing quote
        } else if (ch === '"') {
            // Double-quoted segment: consume until closing quote
            inToken = true;
            i++;
            while (i < input.length && input[i] !== '"') {
                current += input[i];
                i++;
            }
            i++; // skip closing quote
        } else if (ch === ' ' || ch === '\t') {
            // Unquoted whitespace: token boundary
            if (inToken) {
                tokens.push(current);
                current = '';
                inToken = false;
            }
            i++;
        } else {
            inToken = true;
            current += ch;
            i++;
        }
    }

    if (inToken) {
        tokens.push(current);
    }

    return tokens;
}
