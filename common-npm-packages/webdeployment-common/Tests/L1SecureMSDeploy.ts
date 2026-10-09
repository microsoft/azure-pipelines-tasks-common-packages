import * as assert from 'assert';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tl from 'azure-pipelines-task-lib/task';
import * as msdeployUtility from '../msdeployutility';
import { DeployUsingMSDeploy, executeWebDeploy } from '../deployusingmsdeploy';
import { Package } from '../packageUtility';
import { WebDeploymentCompatibilityFixEnabled } from '../featureFlags';

export function runL1SecureMSDeployTests(this: Mocha.Suite) {
    this.timeout(60000);
    const flagEnvironmentVariable = 'DISTRIBUTEDTASK_TASKS_' + WebDeploymentCompatibilityFixEnabled.toUpperCase();
    let previousFeatureValue: string | undefined;

    beforeEach(() => previousFeatureValue = process.env[flagEnvironmentVariable]);
    afterEach(() => {
        if (previousFeatureValue === undefined) {
            delete process.env[flagEnvironmentVariable];
        }
        else {
            process.env[flagEnvironmentVariable] = previousFeatureValue;
        }
    });

    [undefined, 'true'].forEach(featureValue => {
        it('Preserves literal paths and parameter values with both genuine MSDeploy engines when compatibility is ' +
            (featureValue === undefined ? 'enabled by default' : 'explicitly enabled'), async function() {
            if (tl.getPlatform() !== tl.Platform.Windows) {
                this.skip();
            }
            if (featureValue === undefined) {
                delete process.env[flagEnvironmentVariable];
            }
            else {
                process.env[flagEnvironmentVariable] = featureValue;
            }

            const work = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-msdeploy-'));
            const source = path.join(work, 'source `folder & with spaces');
            const parameters = path.join(work, 'parameters `file & %PATH% with spaces.xml');
            const expectedValue = 'literal `value & %PATH%';
            fs.mkdirSync(source);
            fs.writeFileSync(path.join(source, 'sample.txt'), 'TOKEN');
            fs.writeFileSync(parameters, '<parameters />');

            try {
                for (const engine of ['M142', 'M229']) {
                    const engineDirectory = path.join(work, engine + ' engine `literal & %PATH% with spaces');
                    fs.cpSync(path.join(__dirname, '..', 'MSDeploy', engine, 'MSDeploy3.6'), engineDirectory, { recursive: true });
                    const executable = path.join(engineDirectory, 'msdeploy.exe');
                    const packageFile = path.join(work, engine + ' package `archive & with spaces.zip');
                    const packaged = childProcess.spawnSync(executable, [
                        '-verb:sync',
                        "-source:dirPath='" + source + "'",
                        "-dest:package='" + packageFile + "'",
                        '-declareParam:name="Display Name",kind=TextFile,scope=".*sample\\.txt$",match="TOKEN",defaultValue="TOKEN"'
                    ], { shell: false, windowsVerbatimArguments: true, argv0: '"' + executable + '"', encoding: 'utf8', timeout: 30000 });
                    assert.ifError(packaged.error);
                    assert.strictEqual(packaged.status, 0, packaged.stdout + packaged.stderr);
                    const destinations: string[] = [];
                    const realSpawn = childProcess.spawn;
                    const sandbox = sinon.createSandbox();
                    try {
                        sandbox.stub(tl, 'getPipelineFeature').callsFake(name =>
                            name === 'SecureMSDeployCommandExecution' || name === WebDeploymentCompatibilityFixEnabled);
                        sandbox.stub(tl, 'getVariable').callsFake(name => name === 'System.DefaultWorkingDirectory' ? work : undefined);
                        sandbox.stub(tl, 'filePathSupplied').withArgs('SetParametersFile').returns(true);
                        sandbox.stub(msdeployUtility, 'getMSDeployFullPath').resolves(executable);
                        sandbox.stub(msdeployUtility, 'getSpaceSafeToolPath').throws(new Error('Short paths must not be needed'));
                        sandbox.stub(tl, 'exec').throws(new Error('Secure execution must not use legacy ToolRunner quoting'));
                        sandbox.stub(childProcess, 'spawn').callsFake((tool: string, args: string[], options: childProcess.SpawnOptions) => {
                            assert.strictEqual(tool, executable);
                            assert.strictEqual(options.shell, false);
                            assert.strictEqual(options.windowsVerbatimArguments, true);
                            assert.strictEqual(options.argv0, '"' + executable + '"');

                            const destination = path.join(work, engine + ' destination `folder & ' + destinations.length);
                            fs.mkdirSync(destination);
                            destinations.push(destination);
                            // Use disposable filesystem providers, but preserve the production transport and value quoting.
                            const localArgs = args.filter(arg => arg.indexOf('IIS Web Application Name') === -1)
                                .map(arg => arg.indexOf('-source:') === 0 ? arg.replace(/IisApp/i, 'dirPath') :
                                    arg.indexOf('-dest:') === 0 ? "-dest:dirPath='" + destination + "'" : arg);
                            return realSpawn(tool, localArgs, { ...options, cwd: work });
                        });

                        for (const suffix of ['', '\n', '\r\n']) {
                            const additionalArguments = "-setParam:name='Display Name',value='" + expectedValue +
                                "' -retryAttempts:2 -retryInterval:1000" + suffix;
                            await DeployUsingMSDeploy(packageFile, 'local `site', null, false, false, false,
                                null, parameters, additionalArguments, false, true);
                            await executeWebDeploy({
                                package: new Package(packageFile),
                                appName: 'local `site',
                                publishUrl: 'localhost',
                                userName: 'unused',
                                password: 'unused',
                                setParametersFile: parameters,
                                additionalArguments,
                                useWebDeploy: true
                            });
                        }
                        assert.strictEqual(destinations.length, 6);
                        destinations.forEach(destination => {
                            assert.strictEqual(fs.readFileSync(path.join(destination, 'sample.txt'), 'utf8'), expectedValue);
                        });
                    }
                    finally {
                        sandbox.restore();
                    }
                }
            }
            finally {
                await fs.promises.rm(work, { recursive: true, maxRetries: 5, retryDelay: 100 });
            }
        });
    });
}
