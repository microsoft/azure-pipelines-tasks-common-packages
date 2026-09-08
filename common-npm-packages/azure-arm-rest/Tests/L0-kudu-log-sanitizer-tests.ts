import assert = require('assert');
import { sanitizeKuduLogForConsole } from '../azure-arm-app-service-kudu';

// sanitizeKuduLogForConsole is a pure function (its only side effect is a console.log telemetry
// emission and a read of the DISTRIBUTEDTASK_TASKS_ENABLEKUDULOGVSOCOMMANDSANITIZATION env var
// via tl.getPipelineFeature), so it is exercised in-process here rather than via the
// MockTestRunner subprocess pattern used for the HTTP-calling Kudu methods elsewhere in this
// folder - no HTTP mocking is needed and env var manipulation is all that's required to flip
// the feature on/off between cases.
const FEATURE_ENV_VAR = 'DISTRIBUTEDTASK_TASKS_ENABLEKUDULOGVSOCOMMANDSANITIZATION';
const ALLOWED_COMMANDS_ENV_VAR = 'AGENT_ALLOWEDLOGGINGCOMMANDS';

// IMPORTANT: mocha's reporter prints `it(...)` titles (and any failed assertion message) to the
// real process stdout, which - unlike a plain local `mocha`/`node` run - IS scanned by the actual
// Azure Pipelines agent for the literal "##vso[" (and leading "##[") trigger sequence when this
// suite runs inside a real CI job. So test titles/assert messages below intentionally avoid ever
// spelling out that literal sequence (e.g. built up from parts at runtime instead), even though
// the *payloads passed into sanitizeKuduLogForConsole* safely use the real sequence - those never
// reach real stdout because console.log is mocked/captured for the duration of each test and
// restored again in afterEach, before mocha prints the next result line.
function buildVsoCommand(command: string): string {
    return '##' + 'vso[' + command;
}

function buildLeadingBracketCommand(command: string): string {
    return '##' + '[' + command;
}

export function KuduLogSanitizerTests() {
    describe('sanitizeKuduLogForConsole', () => {
        let originalFeatureValue: string | undefined;
        let originalAllowedCommandsValue: string | undefined;
        let originalConsoleLog: (...args: any[]) => void;
        let consoleOutput: string[];

        beforeEach(() => {
            originalFeatureValue = process.env[FEATURE_ENV_VAR];
            delete process.env[FEATURE_ENV_VAR];
            originalAllowedCommandsValue = process.env[ALLOWED_COMMANDS_ENV_VAR];
            delete process.env[ALLOWED_COMMANDS_ENV_VAR];

            consoleOutput = [];
            originalConsoleLog = console.log;
            console.log = (...args: any[]) => {
                consoleOutput.push(args.join(' '));
            };
        });

        afterEach(() => {
            if (originalFeatureValue === undefined) {
                delete process.env[FEATURE_ENV_VAR];
            } else {
                process.env[FEATURE_ENV_VAR] = originalFeatureValue;
            }
            if (originalAllowedCommandsValue === undefined) {
                delete process.env[ALLOWED_COMMANDS_ENV_VAR];
            } else {
                process.env[ALLOWED_COMMANDS_ENV_VAR] = originalAllowedCommandsValue;
            }
            console.log = originalConsoleLog;
        });

        it('leaves clean text untouched and emits no telemetry', () => {
            const clean = 'npm install\nadded 42 packages in 3s\n';

            const result = sanitizeKuduLogForConsole(clean, 'AzureRmWebAppDeployment');

            assert.strictEqual(result, clean, 'clean text should pass through unmodified');
            assert.strictEqual(
                consoleOutput.some(line => line.includes('telemetry.publish')),
                false,
                'no telemetry should be emitted for clean input');
        });

        it('detects a task.setvariable logging command and reports telemetry even when the feature is off', () => {
            delete process.env[FEATURE_ENV_VAR];
            const payload = buildVsoCommand('task.setvariable variable=ORYX_INJECTED]true');

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert.strictEqual(result, payload, 'text must be returned unmodified when the feature is off');
            const telemetryLine = consoleOutput.find(line => line.includes('telemetry.publish'));
            assert(telemetryLine, 'telemetry should always be emitted when a logging command is detected');
            assert(telemetryLine.includes('area=TaskHub;feature=AzureRmWebAppDeployment'));
            assert(telemetryLine.includes('"event":"KuduLogVsoCommandsDetected"'));
            assert(telemetryLine.includes('"enforced":false'));
            assert(telemetryLine.includes('"allowlistPresent":false'));
            assert(telemetryLine.includes('"escapedCount":0'));
            assert(telemetryLine.includes('"commands":"task.setvariable"'));
        });

        it('neutralizes a non-whitelisted trigger sequence and leaves the rest of the text intact when the feature is on', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            // Whitelist that does NOT contain task.setvariable, so it must be neutralized.
            process.env[ALLOWED_COMMANDS_ENV_VAR] = 'task.complete';
            const payload = `Oryx build log line one\n${buildVsoCommand('task.setvariable variable=ORYX_INJECTED]true')}\nOryx build log line two`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert.strictEqual(result.includes(buildVsoCommand('task.setvariable')), false, 'the non-whitelisted trigger sequence must be neutralized');
            assert(result.includes('##_vso[task.setvariable variable=ORYX_INJECTED]true'),
                'the neutralized text should still be readable/diagnosable in the log');
            assert(result.includes('Oryx build log line one'));
            assert(result.includes('Oryx build log line two'));

            const telemetryLine = consoleOutput.find(line => line.includes('telemetry.publish'));
            assert(telemetryLine, 'telemetry should still be emitted when enforcing');
            assert(telemetryLine.includes('"event":"KuduLogVsoCommandsSanitized"'));
            assert(telemetryLine.includes('"enforced":true'));
            assert(telemetryLine.includes('"allowlistPresent":true'), 'a non-empty allow-list should be reported');
            assert(telemetryLine.includes('"escapedCount":1'), 'exactly one non-whitelisted sequence was neutralized');
        });

        it('preserves whitelisted commands and escapes only non-whitelisted ones when the feature is on', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            process.env[ALLOWED_COMMANDS_ENV_VAR] = 'task.setvariable';
            const payload = `${buildVsoCommand('task.setvariable variable=OK]yes')}\n${buildVsoCommand('task.setsecret]stolen')}`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert(result.includes(buildVsoCommand('task.setvariable variable=OK]yes')),
                'whitelisted command (task.setvariable) must be preserved verbatim');
            assert.strictEqual(result.includes(buildVsoCommand('task.setsecret')), false,
                'non-whitelisted command (task.setsecret) must be neutralized');
            assert(result.includes('##_vso[task.setsecret]stolen'),
                'the neutralized non-whitelisted command should still be readable');
        });

        it('matches the whitelist case-insensitively', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            // Whitelist delivered upper-cased; injected command is lower-case.
            process.env[ALLOWED_COMMANDS_ENV_VAR] = 'TASK.SETVARIABLE';
            const payload = `${buildVsoCommand('task.setvariable variable=OK]yes')}\n${buildVsoCommand('task.complete result=Failed]')}`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert(result.includes(buildVsoCommand('task.setvariable variable=OK]yes')),
                'upper-cased whitelist entry must whitelist the lower-case command');
            assert.strictEqual(result.includes(buildVsoCommand('task.complete')), false,
                'non-whitelisted command must still be neutralized');
        });

        it('allows all logging commands when the whitelist is empty even though the feature is on', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            delete process.env[ALLOWED_COMMANDS_ENV_VAR];
            const payload = `${buildVsoCommand('task.setvariable variable=X]y')}\n${buildVsoCommand('task.setsecret]stolen')}`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert.strictEqual(result, payload, 'empty whitelist must leave every ##vso[ command untouched (allow all)');
            const telemetryLine = consoleOutput.find(line => line.includes('telemetry.publish'));
            assert(telemetryLine, 'detection telemetry is still emitted');
            assert(telemetryLine.includes('"enforced":true'), 'telemetry still reports the feature as enforced');
            // The whole point of allowlistPresent/escapedCount: with the feature on but an empty
            // allow-list nothing is actually escaped, so the rollout signal must NOT look like
            // active protection (see PR #659 review).
            assert(telemetryLine.includes('"allowlistPresent":false'), 'an empty/unset allow-list must be reported as not present');
            assert(telemetryLine.includes('"escapedCount":0'), 'an allow-all no-op must report zero escaped sequences');
        });

        it('always neutralizes a leading bracket sequence when enforcing, regardless of the whitelist', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            // Even with an empty whitelist (allow all ##vso[), a leading ##[ has no command name and
            // is always neutralized.
            delete process.env[ALLOWED_COMMANDS_ENV_VAR];
            const payload = `${buildVsoCommand('task.setvariable variable=X]y')}\n${buildLeadingBracketCommand('section]Starting: attacker section')}`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert(result.includes(buildVsoCommand('task.setvariable variable=X]y')),
                'empty whitelist leaves the ##vso[ command untouched');
            assert.strictEqual(/^##\[/m.test(result), false, 'a leading bracket sequence must always be neutralized when enforcing');

            // Even with an empty allow-list, neutralizing a leading "##[" is real protection, so
            // escapedCount must reflect it (escapedCount > 0) while allowlistPresent stays false.
            const telemetryLine = consoleOutput.find(line => line.includes('telemetry.publish'));
            assert(telemetryLine, 'telemetry should be emitted when enforcing');
            assert(telemetryLine.includes('"allowlistPresent":false'), 'the empty allow-list must be reported as not present');
            assert(telemetryLine.includes('"escapedCount":1'), 'neutralizing the leading bracket must count as one escaped sequence');
        });

        it('cannot be broken out of the telemetry command envelope by a crafted payload', () => {
            process.env[FEATURE_ENV_VAR] = 'false';
            // Attempt to inject a bogus telemetry area/feature or a second logging command via the
            // detected "command name" text itself - the command name capture group is bounded to
            // [a-zA-Z0-9_.]+ so it cannot contain "]" or newlines that could terminate the
            // emitted telemetry envelope early or inject an unrelated command.
            const payload = `${buildVsoCommand('task.setvariable variable=X]value]')}${buildVsoCommand('task.setsecret]stolen')}`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert.strictEqual(result, payload, 'text must be returned unmodified when the feature is off');
            const telemetryLines = consoleOutput.filter(line => line.includes('telemetry.publish'));
            assert.strictEqual(telemetryLines.length, 1, 'exactly one telemetry line should be emitted per call');
            // The telemetry line itself must still be a single well-formed logging command - i.e.
            // JSON.parse must succeed on the payload segment, proving the attacker-controlled
            // command names could not corrupt the envelope.
            const telemetryLine = telemetryLines[0];
            const jsonStart = telemetryLine.indexOf(']') + 1;
            const jsonPayload = telemetryLine.substring(jsonStart);
            assert.doesNotThrow(() => JSON.parse(jsonPayload), 'telemetry JSON payload must remain well-formed');
            assert(telemetryLine.includes('"commands":"task.setvariable,task.setsecret"'));
        });

        it('treats an empty string as a no-op', () => {
            const result = sanitizeKuduLogForConsole('', 'AzureRmWebAppDeployment');
            assert.strictEqual(result, '');
            assert.strictEqual(consoleOutput.length, 0);
        });
    });
}
