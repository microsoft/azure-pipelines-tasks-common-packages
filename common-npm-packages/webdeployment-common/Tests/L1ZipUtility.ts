import * as path from 'path';
import assert = require('assert');
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import * as tl from 'azure-pipelines-task-lib/task';
import * as taskInternal from 'azure-pipelines-task-lib/internal';
import { VsoCommandMode } from 'azure-pipelines-task-lib/externaloutput';
import { ToolRunner } from 'azure-pipelines-task-lib/toolrunner';
import * as zipUtility from '../ziputility';
import { generateTemporaryFolderForDeployment } from '../utility';
import { PackageType } from '../packageUtility';
import { checkIfFilesExistsInZip } from "../ziputility";

export function runL1ZipUtilityTests(this: Mocha.Suite): void {

    it("Should skip ZIP entries validation", async () => {
        const archive = path.join(__dirname, '..', '..', 'Tests', 'L1ZipUtility', 'potentially_malicious.zip');

        const exists = await checkIfFilesExistsInZip(archive, ['index.html']);

        assert.strictEqual(exists, true);
    });

    describe('Extraction output policy', () => {
        const marker = '##vso[task.setvariable variable=archiveDiagnostic;]value';
        const modes: (VsoCommandMode | undefined)[] = [undefined, 'disabled', 'telemetryOnly', 'blockOnly', 'blockAndTelemetry'];
        const tools = ['unzip', '7zip24', '7zip25', 'powershell'];
        let sandbox: sinon.SinonSandbox;
        let directory: string;
        let archive: string;
        let destination: string;
        let output: string[];
        let debug: sinon.SinonStub;
        let pipelineFeature: sinon.SinonStub;
        let telemetry: sinon.SinonSpy;
        let originalPowerShell: string | undefined;

        beforeEach(() => {
            sandbox = sinon.createSandbox();
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-output-'));
            archive = path.join(directory, `archive${marker}.zip`);
            destination = path.join(directory, `extracted${marker}`);
            fs.writeFileSync(archive, '');
            originalPowerShell = process.env.ADO_FORCE_USE_PSUNZIP;
            process.env.ADO_FORCE_USE_PSUNZIP = 'false';
            output = [];
            for (const stream of [process.stdout, process.stderr]) {
                sandbox.stub(stream, 'write').callsFake((chunk: string | Uint8Array) => {
                    output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
                    return true;
                });
            }
            debug = sandbox.stub(taskInternal, '_debug');
            sandbox.stub(tl, 'debug');
            telemetry = sandbox.spy(taskInternal, '_command');
            pipelineFeature = sandbox.stub(tl, 'getPipelineFeature').returns(false);
        });

        afterEach(() => {
            sandbox.restore();
            if (originalPowerShell === undefined) {
                delete process.env.ADO_FORCE_USE_PSUNZIP;
            } else {
                process.env.ADO_FORCE_USE_PSUNZIP = originalPowerShell;
            }
            fs.rmSync(directory, { recursive: true, force: true });
        });

        function selectTool(tool: string): void {
            sandbox.stub(tl, 'getPlatform').returns(tool === 'unzip' ? tl.Platform.Linux : tl.Platform.Windows);
            pipelineFeature.returns(tool === '7zip25');
            process.env.ADO_FORCE_USE_PSUNZIP = tool === 'powershell' ? 'true' : 'false';
        }

        function useChildProcess(tool: string, exitCode: number = 0): void {
            selectTool(tool);
            sandbox.stub(tl, 'which').returns(process.execPath);
            const args = tool === 'unzip' ? [archive, '-d', destination]
                : tool === 'powershell' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
                    `Expand-Archive -Path "${archive}" -DestinationPath "${destination}" -Force`]
                : ['x', `-o${destination}`, archive];
            const script = [
                `require('assert').deepStrictEqual(process.argv.slice(1), ${JSON.stringify(args)});`,
                `process.stdout.write(${JSON.stringify(`stdout ${marker}\r\n`)});`,
                `process.stderr.write(${JSON.stringify(`stderr ${marker}\n`)});`,
                `process.exitCode = ${exitCode};`
            ].join('\n');
            sandbox.stub(tl, 'tool').callsFake(() => new ToolRunner(process.execPath).arg(['-e', script, '--']));
        }

        for (const mode of modes) {
            it(`forwards the caller mode through temporary-folder extraction (${mode || 'default'})`, async () => {
                sandbox.stub(tl, 'getVariable').withArgs('Agent.TempDirectory').returns(directory);
                const extract = sandbox.stub(zipUtility, 'unzip').resolves();

                const folder = await generateTemporaryFolderForDeployment(false, archive, PackageType.zip, mode);

                assert(extract.calledOnceWithExactly(archive, folder, mode || 'disabled'));
                assert.strictEqual(path.dirname(folder), directory);
            });

            for (const tool of tools) {
                it(`filters ${tool} display without changing child arguments (${mode || 'default'})`, async () => {
                    useChildProcess(tool);

                    await zipUtility.unzip(archive, destination, mode);

                    const blocking = mode === 'blockOnly' || mode === 'blockAndTelemetry';
                    const displayedMarker = blocking ? marker.replace('##vso[', '##_vso[') : marker;
                    const displayed = output.join('');
                    assert(displayed.includes(`stdout ${displayedMarker}\r\n`));
                    assert(displayed.includes(`stderr ${displayedMarker}\n`));
                    assert.strictEqual(displayed.includes(marker), !blocking);
                    assert(debug.calledWith(`extracting ${archive} to ${destination}`.split(marker).join(displayedMarker)));
                    assert(debug.calledWith(`extracted ${archive} to ${destination} Successfully`.split(marker).join(displayedMarker)));
                    if (tool === 'powershell') {
                        assert(debug.calledWith(`Command to execute: 'Expand-Archive -Path "${archive}" -DestinationPath "${destination}" -Force'`
                            .split(marker).join(displayedMarker)));
                    }
                    const events = telemetry.getCalls().filter(call => call.args[0] === 'telemetry.publish'
                        && call.args[1].feature === 'ExternalOutputVsoCommand');
                    assert.strictEqual(events.length > 0, mode === 'telemetryOnly' || mode === 'blockAndTelemetry');
                    if (events.length) {
                        assert(events.some(call => JSON.parse(call.args[2]).source === 'childProcess'));
                        for (const event of events) {
                            const data = JSON.parse(event.args[2]);
                            assert.strictEqual(data.commandName, 'task.setvariable');
                            assert.strictEqual(data.blocked, mode === 'blockAndTelemetry');
                            assert(!event.args[2].includes(marker));
                            assert(!event.args[2].includes(directory));
                        }
                    }
                });
            }
        }

        for (const tool of tools) {
            it(`preserves ${tool} extraction failure`, async () => {
                useChildProcess(tool, 7);

                await assert.rejects(() => zipUtility.unzip(archive, destination, 'blockAndTelemetry'));
            });

            it(`extracts original files with the real ${tool} tool`, async function () {
                if ((process.platform === 'win32') === (tool === 'unzip')) {
                    this.skip();
                }
                this.timeout(30000);
                if (process.platform === 'win32') {
                    selectTool(tool);
                }
                const source = path.join(directory, 'source');
                const filename = `config${marker}.json`;
                archive = path.join(directory, 'input.zip');
                destination = path.join(directory, 'extracted');
                fs.mkdirSync(source);
                fs.writeFileSync(path.join(source, filename), '{"setting":"original"}');
                await zipUtility.archiveFolder(source, directory, path.basename(archive));
                output = [];

                await zipUtility.unzip(archive, destination, 'blockAndTelemetry');

                assert.deepStrictEqual(fs.readdirSync(destination), [filename]);
                assert.strictEqual(fs.readFileSync(path.join(destination, filename), 'utf8'), '{"setting":"original"}');
                assert(!output.join('').includes(marker));
                if (tool === 'unzip') {
                    assert(output.join('').includes(marker.replace('##vso[', '##_vso[')));
                }
            });
        }
    });
}