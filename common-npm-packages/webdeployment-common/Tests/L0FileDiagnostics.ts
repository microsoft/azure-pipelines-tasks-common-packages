import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tl from 'azure-pipelines-task-lib/task';
import * as taskInternal from 'azure-pipelines-task-lib/internal';
import { VsoCommandMode } from 'azure-pipelines-task-lib/externaloutput';
import * as utility from '../utility';
import { jsonVariableSubstitution } from '../jsonvariablesubstitutionutility';
import { substituteAppSettingsVariables, substituteXmlVariables } from '../xmlvariablesubstitutionutility';
import { specialXdtTransformation } from '../xdttransformationutility';
import { fileTransformations, advancedFileTransformations, enhancedFileTransformations } from '../fileTransformationsUtility';

export function runFileDiagnosticsTests(): void {
    const modes: (VsoCommandMode | undefined)[] = [undefined, 'disabled', 'telemetryOnly', 'blockOnly', 'blockAndTelemetry'];
    const names = [
        'ordinary file',
        '##vso[task.setvariable variable=fileDiagnostic]value',
        '####vso[task.setvariable variable=fileDiagnostic]value',
        '####VsO[task.setvariable variable=fileDiagnostic]value',
        '##[warning]file'
    ];
    let sandbox: sinon.SinonSandbox;
    let directory: string;
    let output: string[];
    let telemetry: sinon.SinonSpy;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'file-diagnostics-'));
        output = [];
        // Capture the real task-lib writer, rather than replacing the output filter.
        sandbox.stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
            output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
            return true;
        });
        sandbox.stub(console, 'log');
        sandbox.stub(tl, 'debug');
        sandbox.stub(tl, 'loc').callsFake((key: string, ...args: string[]) => `${key}: ${args.join(' ')}`);
        telemetry = sandbox.spy(taskInternal, '_command');
    });

    afterEach(() => {
        sandbox.restore();
        for (const file of fs.readdirSync(directory)) {
            fs.unlinkSync(path.join(directory, file));
        }
        fs.rmdirSync(directory);
    });

    function displayed(value: string, mode: VsoCommandMode | undefined): string {
        return mode === 'blockOnly' || mode === 'blockAndTelemetry'
            ? value.split('##vso[').join('##_vso[')
            : value;
    }

    function assertDiagnostic(message: string, mode: VsoCommandMode | undefined): void {
        assert(output.includes(displayed(message, mode) + '\n'),
            'the production writer must preserve surrounding text and append a newline');
    }

    function assertTelemetry(mode: VsoCommandMode | undefined, hasMarker: boolean): void {
        const events = telemetry.getCalls().filter(call => call.args[0] === 'telemetry.publish');
        const expected = hasMarker && (mode === 'telemetryOnly' || mode === 'blockAndTelemetry');
        assert.strictEqual(events.length > 0, expected, 'only telemetry modes report exact VSO markers');
        for (const event of events) {
            assert.deepStrictEqual(event.args[1], { area: 'TaskLib', feature: 'ExternalOutputVsoCommand' });
            assert.deepStrictEqual(JSON.parse(event.args[2]), {
                source: 'repository',
                commandName: 'task.setvariable',
                blocked: mode === 'blockAndTelemetry',
                SYSTEM_TASKINSTANCEID: '',
                SYSTEM_TASKINSTANCENAME: '',
                SYSTEM_JOBID: '',
                SYSTEM_PLANID: ''
            }, 'telemetry must contain metadata only, never paths, command data, or substitution values');
        }
    }

    for (const mode of modes) {
        describe(`caller mode ${mode === undefined ? 'omitted/default' : mode}`, () => {
            beforeEach(() => {
                sandbox.stub(tl, 'getVariable').returns(undefined);
                sandbox.stub(taskInternal, '_getVariable').returns(undefined);
            });

            for (const name of names) {
                for (const allTypes of [false, true]) {
                    it(`writes JSON filename diagnostics and retains original paths (${name}, allTypes=${allTypes})`, () => {
                        const file = path.join(directory, `${name}.json`);
                        fs.writeFileSync(file, '{"setting":"before"}');
                        const find = sandbox.stub(utility, 'findfiles').returns([file]);
                        sandbox.stub(tl, 'getVariables').returns([{ name: 'setting', value: 'after', secret: false }]);
                        const read = sandbox.spy(fs, 'readFileSync');
                        const write = sandbox.spy(tl, 'writeFile');

                        assert.strictEqual(jsonVariableSubstitution(directory, [`${name}.json`], allTypes, mode), true);

                        assert(find.calledWith(file), 'search with the original pattern');
                        assert(read.calledWith(file), 'read the original matched filename');
                        assert(write.calledWith(file), 'write the original matched filename');
                        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { setting: 'after' });
                        assertDiagnostic(`JSONvariableSubstitution: ${name}.json`, mode);
                        assertDiagnostic(`Processing file: ${file}`, mode);
                        assertDiagnostic(`JSONvariableSubstitution: ${file}`, mode);
                        assertTelemetry(mode, name.includes('##vso['));
                    });
                }

                it(`writes empty JSON filename diagnostics (${name})`, () => {
                    const file = path.join(directory, `${name}.json`);
                    fs.writeFileSync(file, '');
                    sandbox.stub(utility, 'findfiles').returns([file]);
                    sandbox.stub(tl, 'getVariables').returns([]);
                    const write = sandbox.spy(tl, 'writeFile');

                    assert.strictEqual(jsonVariableSubstitution(directory, ['*.json'], undefined, mode), false);

                    assert.strictEqual(write.called, false, 'empty files must not be rewritten');
                    assert.strictEqual(fs.readFileSync(file, 'utf8'), '');
                    assertDiagnostic(`The following input files either empty: ${file}. No substitution was performed.`, mode);
                    assertTelemetry(mode, name.includes('##vso['));
                });

                for (const changed of [false, true]) {
                    it(`writes XML filename diagnostics and retains original paths (${name}, changed=${changed})`, () => {
                        const file = path.join(directory, `${name}.config`);
                        fs.writeFileSync(file, '<configuration><appSettings><add key="setting" value="before"/></appSettings></configuration>');
                        const read = sandbox.spy(fs, 'readFileSync');
                        const write = sandbox.spy(tl, 'writeFile');

                        assert.strictEqual(substituteXmlVariables(file, ['appSettings'], changed ? { setting: 'after' } : {}, null, mode), changed);

                        assert(read.calledWith(file), 'read the original configuration filename');
                        assert.strictEqual(write.calledWith(file), changed, 'only changed configurations are rewritten');
                        assert(fs.readFileSync(file, 'utf8').includes(`value="${changed ? 'after' : 'before'}"`));
                        assertDiagnostic(`VariableSubstitutionInitiated: ${file}`, mode);
                        assertDiagnostic(`${changed ? 'ConfigFileUpdated' : 'SkippedUpdatingFile'}: ${file}`, mode);
                        assertTelemetry(mode, name.includes('##vso['));
                    });
                }

                it(`writes XDT filename diagnostics and retains original tool arguments (${name})`, function () {
                    if (process.platform !== 'win32') {
                        this.skip();
                    }
                    const file = path.join(directory, `${name}.config`);
                    const transform = path.join(directory, `${name}.Release.config`);
                    const destination = path.join(directory, `${name}.result.config`);
                    fs.writeFileSync(file, '<configuration/>');
                    fs.writeFileSync(transform, '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform"/>');
                    sandbox.stub(tl, 'findMatch').returns([file]);
                    sandbox.stub(tl, 'getPipelineFeature').returns(true);
                    const execute = sandbox.stub(tl, 'execSync').returns({ code: 0, stdout: '', stderr: '' });

                    assert.strictEqual(specialXdtTransformation(directory, '*.Release.config', '*.config', `${name}.result.config`, mode), true);

                    assert.strictEqual(execute.callCount, 1);
                    assert.deepStrictEqual(execute.firstCall.args[1], [
                        `s:${file}`, `t:${transform.toLowerCase()}`, `d:${destination}`, 'pw', 'i', 'verbose'
                    ]);
                    assertDiagnostic(`ApplyingXDTtransformation: ${transform.toLowerCase()} ${file}`, mode);
                    assertTelemetry(mode, name.toLowerCase().includes('##vso['));
                });
            }

            it('preserves CR/LF around markers without changing raw JSON filesystem arguments', () => {
                const file = path.join(directory, 'first\r##vso[task.setvariable variable=fileDiagnostic]value\nsecond\r\n##vso[task.setvariable]tail.json');
                const find = sandbox.stub(utility, 'findfiles').returns([file]);
                const read = sandbox.stub(fs, 'readFileSync').withArgs(file).returns(Buffer.from('{"setting":"before"}'));
                const write = sandbox.stub(tl, 'writeFile');
                sandbox.stub(tl, 'getVariables').returns([{ name: 'setting', value: 'after', secret: false }]);

                assert.strictEqual(jsonVariableSubstitution(directory, [path.basename(file)], true, mode), true);

                assert(find.calledWith(file));
                assert(read.calledOnceWithExactly(file));
                assert(write.calledWith(file));
                assertDiagnostic(`Processing file: ${file}`, mode);
                assertDiagnostic(`JSONvariableSubstitution: ${file}`, mode);
                assertTelemetry(mode, true);
            });

            it('preserves CR/LF around markers in XML diagnostics and raw paths', () => {
                const file = path.join(directory, 'first\r##vso[task.setvariable]value\nsecond\r\n##vso[task.setvariable]tail.config');
                const template = path.join(directory, 'template.config');
                fs.writeFileSync(template, '<configuration/>');
                const stats = fs.statSync(template);
                sandbox.stub(tl, 'exist').returns(true);
                sandbox.stub(tl, 'stats').returns(stats);
                const read = sandbox.stub(fs, 'readFileSync').withArgs(file).returns(Buffer.from(
                    '<configuration><appSettings><add key="setting" value="before"/></appSettings></configuration>'));
                const write = sandbox.stub(tl, 'writeFile');

                assert.strictEqual(substituteXmlVariables(file, ['appSettings'], { setting: 'after' }, null, mode), true);

                assert(read.calledOnceWithExactly(file));
                assert(write.calledWith(file));
                assertDiagnostic(`VariableSubstitutionInitiated: ${file}`, mode);
                assertDiagnostic(`ConfigFileUpdated: ${file}`, mode);
                assertTelemetry(mode, true);
            });

            it('preserves CR/LF around markers in XDT diagnostics and raw tool arguments', function () {
                if (process.platform !== 'win32') {
                    this.skip();
                }
                const name = 'first\r##vso[task.setvariable]value\nsecond\r\n##vso[task.setvariable]tail';
                const file = path.join(directory, `${name}.config`);
                const transform = path.join(directory, `${name}.Release.config`).toLowerCase();
                const destination = path.join(directory, `${name}.result.config`);
                sandbox.stub(tl, 'findMatch').returns([file]);
                sandbox.stub(tl, 'exist').returns(true);
                sandbox.stub(tl, 'getPipelineFeature').returns(true);
                const read = sandbox.stub(fs, 'readFileSync').withArgs(transform).returns(Buffer.from(
                    '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform"/>'));
                const execute = sandbox.stub(tl, 'execSync').returns({ code: 0, stdout: '', stderr: '' });

                assert.strictEqual(specialXdtTransformation(directory, '*.Release.config', '*.config', `${name}.result.config`, mode), true);

                assert(read.calledOnceWithExactly(transform));
                assert.deepStrictEqual(execute.firstCall.args[1], [
                    `s:${file}`, `t:${transform}`, `d:${destination}`, 'pw', 'i', 'verbose'
                ]);
                assertDiagnostic(`ApplyingXDTtransformation: ${transform} ${file}`, mode);
                assertTelemetry(mode, true);
            });

            it('propagates the mode through the XML file-matching wrapper', () => {
                const file = path.join(directory, `${names[1]}.config`);
                fs.writeFileSync(file, '<configuration/>');
                const find = sandbox.stub(tl, 'findMatch').returns([file]);
                sandbox.stub(tl, 'getVariables').returns([]);

                substituteAppSettingsVariables(directory, true, `${names[1]}.config`, mode);

                assert(find.calledWith(directory, `${names[1]}.config`));
                assertDiagnostic(`VariableSubstitutionInitiated: ${file}`, mode);
                assertDiagnostic(`SkippedUpdatingFile: ${file}`, mode);
                assertTelemetry(mode, true);
            });

            const entryPoints: { name: string; run: (rules: string[], mode?: VsoCommandMode) => void }[] = [
                {
                    name: 'fileTransformations',
                    run: (_rules, mode) => fileTransformations(true, ['*.json'], true, true, directory, false, mode)
                },
                {
                    name: 'advancedFileTransformations',
                    run: (rules, mode) => {
                        advancedFileTransformations(true, [], true, 'xml', directory, rules, mode);
                        advancedFileTransformations(true, ['*.config'], false, 'xml', directory, [], mode);
                        advancedFileTransformations(true, [], false, 'json', directory, [], mode);
                    }
                },
                {
                    name: 'enhancedFileTransformations',
                    run: (rules, mode) => enhancedFileTransformations(true, true, directory, rules, ['*.config'], ['*.json'], mode)
                }
            ];

            for (const entry of entryPoints) {
                for (const rule of ['basic', 'special', 'destination']) {
                    if (entry.name === 'fileTransformations' && rule !== 'basic' ||
                        entry.name === 'enhancedFileTransformations' && rule === 'basic') {
                        continue;
                    }
                    it(`propagates the mode to production JSON/XML/XDT loggers (${entry.name}, ${rule})`, function () {
                        if (process.platform !== 'win32') {
                            this.skip();
                        }
                        const file = path.join(directory, `${names[1]}.config`);
                        const transform = path.join(directory, `${names[1]}.Release.config`);
                        const jsonFile = path.join(directory, `${names[1]}.json`);
                        fs.writeFileSync(file, '<configuration/>');
                        fs.writeFileSync(transform, '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform"/>');
                        fs.writeFileSync(jsonFile, '{"setting":"before"}');
                        sandbox.stub(tl, 'osType').returns('Windows_NT');
                        sandbox.stub(tl, 'getBoolInput').returns(false);
                        sandbox.stub(tl, 'getVariables').returns([{ name: 'setting', value: 'after', secret: false }]);
                        sandbox.stub(tl, 'findMatch').returns([file, transform]);
                        sandbox.stub(utility, 'findfiles').returns([jsonFile]);
                        sandbox.stub(tl, 'getPipelineFeature').returns(true);
                        const execute = sandbox.stub(tl, 'execSync').returns({ code: 0, stdout: '', stderr: '' });
                        const debug = sandbox.spy(taskInternal, '_debug');
                        const rules = rule === 'basic' ? [] : [
                            '-transform *.Release.config -xml *.config' + (rule === 'destination' ? ' -result *.result.config' : '')
                        ];

                        entry.run(rules, mode);

                        assert(execute.called, 'run the XDT route with a mocked subprocess');
                        assertDiagnostic(`Processing file: ${jsonFile}`, mode);
                        assertDiagnostic(`VariableSubstitutionInitiated: ${file}`, mode);
                        if (rule === 'basic') {
                            const debugMessages = debug.getCalls().map(call => call.args[0]);
                            assert(debugMessages.includes(displayed(`Applying XDT Transformation : ${transform} -> ${file}`, mode)),
                                'basic XDT keeps debug severity and uses the caller mode');
                        }
                        else {
                            assertDiagnostic(`ApplyingXDTtransformation: ${transform.toLowerCase()} ${file}`, mode);
                        }
                        assertTelemetry(mode, true);
                    });
                }
            }
        });
    }

    it('does not retain a mode between calls', () => {
        const file = path.join(directory, `${names[1]}.json`);
        fs.writeFileSync(file, '');
        sandbox.stub(utility, 'findfiles').returns([file]);
        sandbox.stub(tl, 'getVariables').returns([]);

        jsonVariableSubstitution(directory, ['*.json'], false, 'blockOnly');
        output = [];
        jsonVariableSubstitution(directory, ['*.json']);

        assertDiagnostic(`Processing file: ${file}`, undefined);
        assert(!output.some(chunk => chunk.includes('##_vso[')), 'default behavior is independent of earlier blocking calls');
    });
}
