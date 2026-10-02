import assert = require("assert");
import os = require("os");
import path = require("path");
import fs = require("fs");
import tl = require("azure-pipelines-task-lib/task");
import { getMSDeployCmdArgs, getMsDeployShortPath, resolveMsDeployInvocation } from "../msdeployutility";
import { executeMSDeploy } from "../deployusingmsdeploy";

// A faithful copy of the argStringToArray splitter used by deployusingmsdeploy.ts, so the
// tests can assert how an escaped value survives the string -> argv[] conversion that runs
// just before msdeploy is launched.
function argStringToArray(argString: string): string[] {
    const args: string[] = [];
    let inQuotes = false;
    let escaped = false;
    let arg = '';
    const append = (c: string) => {
        if (escaped && c !== '"') {
            arg += '\\';
        }
        arg += c;
        escaped = false;
    };
    for (let i = 0; i < argString.length; i++) {
        const c = argString.charAt(i);
        if (c === '"') {
            if (!escaped) { inQuotes = !inQuotes; } else { append(c); }
            continue;
        }
        if (c === "\\" && inQuotes) {
            if (escaped) { append(c); } else { escaped = true; }
            continue;
        }
        if (c === ' ' && !inQuotes) {
            if (arg.length > 0) { args.push(arg); arg = ''; }
            continue;
        }
        append(c);
    }
    if (arg.length > 0) { args.push(arg.trim()); }
    return args;
}

function createDefaultPublishProfile(): { publishUrl: string, userName: string, userPWD: string } {
    return {
        publishUrl: 'http://webapp_name.scm.azurewebsites.net:443',
        userName: '$webapp_name',
        userPWD: 'webapp_password'
    };
}

export function runMSDeployExecTests(): void {

    // The primary (shell-free) path must be byte-for-byte identical to the historical
    // behaviour: escapeForShell defaults to false and every substituted value keeps the
    // "double-quote + single-quote" wrapping. This guards the "no change on the happy path"
    // promise of the fix.
    it('primary path (escapeForShell=false) is byte-identical to the historical form', () => {
        const profile = createDefaultPublishProfile();
        const withFlag = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, true, false, true, null, null, null, true, false, false, undefined, false);
        const withoutFlag = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, true, false, true, null, null, null, true, false, false);
        assert.strictEqual(withFlag, withoutFlag, 'passing escapeForShell=false must equal the default');
        assert.ok(withFlag.indexOf("-source:package=\"'package.zip'\"") !== -1, 'package value keeps the historical quoting');
        assert.ok(withFlag.indexOf('-source:package="\\"') === -1, 'primary path must NOT emit the escaped-double-quote form');
    });

    // On the fallback (command-processor) path every substituted value must be escaped so that,
    // after the string -> argv[] split, it is a single argument wrapped in REAL double quotes -
    // the command processor then treats the whole value as one literal argument.
    it('fallback path (escapeForShell=true) emits an escaped value that survives argStringToArray', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, true, false, true, null, null, null, true, false, false, undefined, true);
        assert.ok(args.indexOf('-source:package="\\"package.zip\\""') !== -1, 'package value is wrapped in escaped double quotes');
        const pkgArg = argStringToArray(args).find(a => a.indexOf('-source:package=') === 0);
        assert.strictEqual(pkgArg, '-source:package="package.zip"', 'after the split the value is a single double-quoted argument');
    });

    // On the fallback (command-processor) path a package file name containing characters the
    // command processor would treat specially must collapse into a single double-quoted
    // argument - never split into multiple tokens.
    it('fallback path keeps a value with special characters as a single argument', () => {
        const profile = createDefaultPublishProfile();
        const special = 'app&b|c(d)^e.zip';
        const args = getMSDeployCmdArgs(special, 'webapp_name', profile, true, false, true, null, null, null, true, false, false, undefined, true);
        const argv = argStringToArray(args);
        const pkgArgs = argv.filter(a => a.indexOf('-source:package=') === 0);
        assert.strictEqual(pkgArgs.length, 1, 'the value stays a single argument');
        assert.strictEqual(pkgArgs[0], '-source:package="' + special + '"', 'special characters are preserved literally inside double quotes');
        const benignArgvLength = argStringToArray(getMSDeployCmdArgs('app.zip', 'webapp_name', profile, true, false, true, null, null, null, true, false, false, undefined, true)).length;
        assert.strictEqual(argv.length, benignArgvLength, 'the special characters do not split the value into extra arguments');
    });

    // A value ending in a backslash must not leave the double-quoted argument unterminated:
    // the trailing backslash is stripped before wrapping so the value stays a single,
    // properly-closed argument (never absorbing the arguments that follow it).
    it('fallback path keeps a value ending in a backslash as one properly-terminated argument', () => {
        const args = getMSDeployCmdArgs('C:\\site\\folder\\', 'webapp_name', null, true, false, true, null, null, null, false, true, false, undefined, true);
        const argv = argStringToArray(args);
        const sourceArgs = argv.filter(a => a.indexOf('-source:IisApp=') === 0);
        assert.strictEqual(sourceArgs.length, 1, 'the value stays a single argument');
        assert.strictEqual(sourceArgs[0], '-source:IisApp="C:\\site\\folder"', 'trailing backslash is stripped and the value is a single quoted argument');
        assert.ok(argv.indexOf('-dest:iisApp="webapp_name"') !== -1, 'the following argument is NOT absorbed into the previous one');
    });

    // getMsDeployShortPath short-circuits when the path already has no space (nothing to do),
    // and when it does transform a path the result must still be space-free (the whole point).
    it('getMsDeployShortPath returns space-free paths unchanged', () => {
        const spaceFree = 'C:\\PROGRA~1\\IIS\\msdeploy.exe';
        assert.strictEqual(getMsDeployShortPath(spaceFree), spaceFree);
        assert.strictEqual(getMsDeployShortPath('msdeploy.exe'), 'msdeploy.exe');
    });

    it('getMsDeployShortPath never returns a spaced path when it transforms one', () => {
        const spaced = 'C:\\Program Files\\IIS\\Microsoft Web Deploy V3\\msdeploy.exe';
        const result = getMsDeployShortPath(spaced);
        // On a host with 8.3 generation the result is a space-free short path; on a hardened
        // host with 8.3 disabled the original (spaced) path is returned and the caller falls
        // back to a shell invocation. Either way the result is the original or is space-free.
        assert.ok(result === spaced || result.indexOf(' ') === -1, 'result is the original path or is space-free');
    });

    // resolveMsDeployInvocation keeps useShell and the resolved directory consistent: a shell
    // is required exactly when no space-free path to msdeploy could be produced.
    it('resolveMsDeployInvocation returns a consistent {directory, useShell}', async () => {
        const invocation = await resolveMsDeployInvocation();
        assert.strictEqual(typeof invocation.directory, 'string');
        assert.strictEqual(typeof invocation.useShell, 'boolean');
        if (!invocation.useShell) {
            assert.ok(invocation.directory.indexOf(' ') === -1, 'primary path directory must be space-free');
        }
    });

    // executeMSDeploy must always launch the literal tool name "msdeploy" (resolved via the
    // PATH entry the callers prepend) with windowsVerbatimArguments, and route shell:true/false
    // straight from the resolved invocation. Stub tl.exec to capture what it is handed.
    it('executeMSDeploy launches the literal "msdeploy" with shell driven by the invocation', async () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msdeployexec-'));
        tl.setVariable('System.DefaultWorkingDirectory', workDir);
        const originalExec = tl.exec;
        const captured: Array<{ tool: string, options: any }> = [];
        (tl as any).exec = (tool: string, _args: string[], options: any) => {
            captured.push({ tool, options });
            return Promise.resolve(0);
        };
        try {
            await executeMSDeploy('-verb:sync -source:package="\'package.zip\'"', { directory: workDir, useShell: false });
            await executeMSDeploy('-verb:sync -source:package="\\"package.zip\\""', { directory: workDir, useShell: true });
        } finally {
            (tl as any).exec = originalExec;
        }
        assert.strictEqual(captured.length, 2, 'tl.exec was called once per invocation');
        for (const call of captured) {
            assert.strictEqual(call.tool, 'msdeploy', 'the tool name is always the literal "msdeploy"');
            assert.strictEqual(call.options.windowsVerbatimArguments, true, 'verbatim arguments are kept');
        }
        assert.strictEqual(captured[0].options.shell, false, 'primary invocation runs without a shell');
        assert.strictEqual(captured[1].options.shell, true, 'fallback invocation runs through a shell');
    });
}
