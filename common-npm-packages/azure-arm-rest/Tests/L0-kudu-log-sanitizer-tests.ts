import assert = require('assert');
import { sanitizeKuduLogForConsole } from '../azure-arm-app-service-kudu';

// sanitizeKuduLogForConsole is a pure function (its only side effect is a console.log telemetry
// emission and a read of the DISTRIBUTEDTASK_TASKS_ENABLEKUDULOGVSOCOMMANDSANITIZATION env var
// via tl.getPipelineFeature), so it is exercised in-process here rather than via the
// MockTestRunner subprocess pattern used for the HTTP-calling Kudu methods elsewhere in this
// folder - no HTTP mocking is needed and env var manipulation is all that's required to flip
// the feature on/off between cases.
const FEATURE_ENV_VAR = 'DISTRIBUTEDTASK_TASKS_ENABLEKUDULOGVSOCOMMANDSANITIZATION';

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
        let originalConsoleLog: (...args: any[]) => void;
        let consoleOutput: string[];

        beforeEach(() => {
            originalFeatureValue = process.env[FEATURE_ENV_VAR];
            delete process.env[FEATURE_ENV_VAR];

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
            assert(telemetryLine.includes('"commands":"task.setvariable"'));
        });

        it('neutralizes the trigger sequence and leaves the rest of the text intact when the feature is on', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            const payload = `Oryx build log line one\n${buildVsoCommand('task.setvariable variable=ORYX_INJECTED]true')}\nOryx build log line two`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert.strictEqual(result.includes(buildVsoCommand('')), false, 'the trigger sequence must be neutralized');
            assert(result.includes('##_vso[task.setvariable variable=ORYX_INJECTED]true'),
                'the neutralized text should still be readable/diagnosable in the log');
            assert(result.includes('Oryx build log line one'));
            assert(result.includes('Oryx build log line two'));

            const telemetryLine = consoleOutput.find(line => line.includes('telemetry.publish'));
            assert(telemetryLine, 'telemetry should still be emitted when enforcing');
            assert(telemetryLine.includes('"event":"KuduLogVsoCommandsSanitized"'));
            assert(telemetryLine.includes('"enforced":true'));
        });

        it('also neutralizes a leading bracket (non task-prefixed) logging command sequence when the feature is on', () => {
            process.env[FEATURE_ENV_VAR] = 'true';
            const payload = `${buildVsoCommand('task.setvariable variable=X]y')}\n${buildLeadingBracketCommand('section]Starting: attacker section')}`;

            const result = sanitizeKuduLogForConsole(payload, 'AzureRmWebAppDeployment');

            assert.strictEqual(result.includes(buildVsoCommand('')), false);
            assert.strictEqual(/^##\[/m.test(result), false, 'a leading bracket sequence must also be neutralized');
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
