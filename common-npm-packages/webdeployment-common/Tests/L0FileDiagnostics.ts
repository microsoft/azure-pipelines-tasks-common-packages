import assert = require('assert');
import fs = require('fs');
import os = require('os');
import path = require('path');
import sinon = require('sinon');
import tl = require('azure-pipelines-task-lib/task');
import utility = require('../utility');
import { jsonVariableSubstitution } from '../jsonvariablesubstitutionutility';
import { substituteXmlVariables } from '../xmlvariablesubstitutionutility';
import { specialXdtTransformation } from '../xdttransformationutility';
import { sanitizeForLoggingCommand } from '../sanitize';

export function runFileDiagnosticsTests(): void {
    const names = [
        'ordinary file',
        '##vso[task.setvariable variable=fileDiagnostic]value',
        '####VsO[task.setvariable variable=fileDiagnostic]value',
        '##[warning]file'
    ];
    let sandbox: sinon.SinonSandbox;
    let directory: string;
    let messages: string[];

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'file-diagnostics-'));
        messages = [];
        sandbox.stub(console, 'log').callsFake((message: string) => messages.push(message));
        sandbox.stub(tl, 'loc').callsFake((key: string, ...args: string[]) => `${key}: ${args.join(' ')}`);
    });

    afterEach(() => {
        sandbox.restore();
        for (const file of fs.readdirSync(directory)) {
            fs.unlinkSync(path.join(directory, file));
        }
        fs.rmdirSync(directory);
    });

    function assertDiagnostics(file: string): void {
        const output = messages.join('\n');
        assert(!/##vso\[|##\[/i.test(output), 'file diagnostics must remain ordinary output');
        if (path.basename(file).startsWith('ordinary')) {
            assert(output.includes(file), 'ordinary filenames must retain their original display');
        }
    }

    it('keeps multiline filenames on one diagnostic line without joining markers', () => {
        assert.strictEqual(sanitizeForLoggingCommand('first\r\nsecond\nthird'), 'first second third');
        assert.strictEqual(sanitizeForLoggingCommand('##\nvso[task.setvariable variable=fileDiagnostic]value'),
            '## vso[task.setvariable variable=fileDiagnostic]value');
    });

    for (const name of names) {
        for (const allTypes of [false, true]) {
            it(`formats JSON filenames without changing substitution (${name}, allTypes=${allTypes})`, () => {
                const file = path.join(directory, `${name}.json`);
                fs.writeFileSync(file, '{"setting":"before"}');
                sandbox.stub(utility, 'findfiles').returns([file]);
                sandbox.stub(tl, 'getVariables').returns([{ name: 'setting', value: 'after', secret: false }]);
                const read = sandbox.spy(fs, 'readFileSync');
                const write = sandbox.spy(tl, 'writeFile');

                assert.strictEqual(jsonVariableSubstitution(directory, ['*.json'], allTypes), true);

                assert(read.calledWith(file), 'read the original matched filename');
                assert(write.calledWith(file), 'write the original matched filename');
                assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { setting: 'after' });
                assertDiagnostics(file);
            });
        }

        it(`formats empty JSON filenames (${name})`, () => {
            const file = path.join(directory, `${name}.json`);
            fs.writeFileSync(file, '');
            sandbox.stub(utility, 'findfiles').returns([file]);
            sandbox.stub(tl, 'getVariables').returns([]);
            const write = sandbox.spy(tl, 'writeFile');

            assert.strictEqual(jsonVariableSubstitution(directory, ['*.json']), false);

            assert.strictEqual(write.called, false, 'empty files must not be rewritten');
            assert.strictEqual(fs.readFileSync(file, 'utf8'), '');
            assertDiagnostics(file);
        });

        for (const changed of [false, true]) {
            it(`formats XML filenames without changing substitution (${name}, changed=${changed})`, () => {
                const file = path.join(directory, `${name}.config`);
                fs.writeFileSync(file, '<configuration><appSettings><add key="setting" value="before"/></appSettings></configuration>');
                const read = sandbox.spy(fs, 'readFileSync');
                const write = sandbox.spy(tl, 'writeFile');

                assert.strictEqual(substituteXmlVariables(file, ['appSettings'], changed ? { setting: 'after' } : {}, null), changed);

                assert(read.calledWith(file), 'read the original configuration filename');
                assert.strictEqual(write.calledWith(file), changed, 'only changed configurations are rewritten');
                assert(fs.readFileSync(file, 'utf8').includes(`value="${changed ? 'after' : 'before'}"`));
                assertDiagnostics(file);
            });
        }

        it(`formats XDT filenames without changing tool arguments (${name})`, function () {
            if (process.platform !== 'win32') {
                this.skip();
            }
            const file = path.join(directory, `${name}.config`);
            const transform = path.join(directory, `${name}.Release.config`);
            fs.writeFileSync(file, '<configuration/>');
            fs.writeFileSync(transform, '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform"/>');
            sandbox.stub(tl, 'findMatch').returns([file]);
            sandbox.stub(tl, 'getPipelineFeature').returns(true);
            const execute = sandbox.stub(tl, 'execSync').returns({ code: 0, stdout: '', stderr: '' });

            assert.strictEqual(specialXdtTransformation(directory, '*.Release.config', '*.config'), true);

            assert.strictEqual(execute.callCount, 1);
            assert.deepStrictEqual(execute.firstCall.args[1], [
                `s:${file}`, `t:${transform.toLowerCase()}`, `d:${file}`, 'pw', 'i', 'verbose'
            ]);
            assertDiagnostics(file);
        });
    }
}
