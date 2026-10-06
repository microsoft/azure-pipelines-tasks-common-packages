import * as assert from 'assert';
import { Writable } from 'stream';
import * as tl from 'azure-pipelines-task-lib/task';
import { IExecOptions, IExecSyncResult } from 'azure-pipelines-task-lib/toolrunner';
import { Kubectl } from '../kubectl-object-model';

interface CapturedCommand {
    args: string[];
    options?: IExecOptions;
}

function installToolMock(resultFactory: (args: string[]) => IExecSyncResult): CapturedCommand[] {
    const calls: CapturedCommand[] = [];

    Object.defineProperty(tl, 'tool', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: (_toolPath: string) => {
            const call: CapturedCommand = { args: [] };
            calls.push(call);

            return {
                arg: (value: string | string[]) => {
                    call.args.push(...(typeof value === 'string' ? [value] : value));
                },
                line: (value: string) => {
                    call.args.push(...value.split(' '));
                },
                execSync: (options?: IExecOptions) => {
                    call.options = options;
                    return resultFactory(call.args);
                }
            };
        }
    });

    return calls;
}

function createResult(stdout: string): IExecSyncResult {
    return {
        code: 0,
        error: null,
        stderr: '',
        stdout
    };
}

describe('kubernetes-common output sanitization', () => {
    const originalTool = Object.getOwnPropertyDescriptor(tl, 'tool');
    const originalWriteExternalOutput = Object.getOwnPropertyDescriptor(tl, 'writeExternalOutput');

    afterEach(() => {
        Object.defineProperty(tl, 'tool', originalTool);
        Object.defineProperty(tl, 'writeExternalOutput', originalWriteExternalOutput);
    });

    it('filters displayed command output without changing the raw result', () => {
        const maliciousOutput = 'pod created\n##vso[task.setvariable variable=BASH_ENV]/tmp/pwned\n';
        const calls = installToolMock(args =>
            args[0] === 'version' ? createResult('{}') : createResult(maliciousOutput)
        );

        const kubectl = new Kubectl('kubectl');
        const result = kubectl.apply('manifest.yaml');

        assert.strictEqual(result.stdout, maliciousOutput);
        assert.deepStrictEqual(calls[1].options.externalOutput, { source: 'childProcess' });
    });

    it('filters version data received from the cluster', () => {
        const serverVersion = 'v1.30.0\n##vso[task.setvariable variable=BASH_ENV]/tmp/pwned';
        const versionResult = JSON.stringify({
            clientVersion: { gitVersion: 'v1.30.0' },
            serverVersion: { gitVersion: serverVersion }
        });
        installToolMock(() => createResult(versionResult));

        let displayedOutput = '';
        const destination = new Writable({
            write: (chunk: Buffer, _encoding, callback) => {
                displayedOutput += chunk.toString();
                callback();
            }
        });
        const writeExternalOutput = tl.writeExternalOutput;
        const sources: string[] = [];
        Object.defineProperty(tl, 'writeExternalOutput', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: (message: string | Buffer, options: tl.ExternalOutputOptions) => {
                sources.push(options.source);
                writeExternalOutput(message, { ...options, destination });
            }
        });

        new Kubectl('kubectl');

        assert.deepStrictEqual(sources, ['childProcess', 'remote']);
        assert.ok(!displayedOutput.includes('##vso['));
        assert.ok(displayedOutput.includes('##_vso[task.setvariable variable=BASH_ENV]'));
        assert.ok(displayedOutput.includes(serverVersion.replace('##vso[', '##_vso[')));
    });
});
