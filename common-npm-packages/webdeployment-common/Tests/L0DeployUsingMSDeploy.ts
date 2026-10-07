import assert = require("assert");
import fs = require("fs");
import os = require("os");
import path = require("path");
import sinon = require("sinon");
import tl = require("azure-pipelines-task-lib/task");
import { IExecOptions } from "azure-pipelines-task-lib/toolrunner";
import childProcess = require("child_process");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import utility = require("../utility");
import msDeployUtility = require("../msdeployutility");

import { DeployUsingMSDeploy, executeWebDeploy } from "../deployusingmsdeploy";
import { Package } from "../packageUtility";
import { WebDeploymentCompatibilityFixEnabled } from "../featureFlags";

export function runDeployUsingMSDeployTests(): void {
    let sandbox: sinon.SinonSandbox;
    let execStub: sinon.SinonStub;
    let legacyExecStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;
    let variableStub: sinon.SinonStub;
    let featureStub: sinon.SinonStub;
    let toolPathStub: sinon.SinonStub;
    let shortPathStub: sinon.SinonStub;
    let workingDirectory: string;
    let stderrOutput: string;
    let stdoutOutput: string;
    let exitSignal: string;
    let originalCompatibilityValue: string | undefined;
    const compatibilityEnvironmentVariable = "DISTRIBUTEDTASK_TASKS_" + WebDeploymentCompatibilityFixEnabled.toUpperCase();

    const regularToolPath = "C:\\Tools\\msdeploy.exe";
    const spacedToolPath = "C:\\Program Files\\IIS\\Microsoft Web Deploy V3\\msdeploy.exe";

    beforeEach(() => {
        originalCompatibilityValue = process.env[compatibilityEnvironmentVariable];
        delete process.env[compatibilityEnvironmentVariable];
        sandbox = sinon.createSandbox();
        stderrOutput = "";
        stdoutOutput = "";
        exitSignal = null;
        workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "msdeploy-test-"));
        variableStub = sandbox.stub(tl, "getVariable").callsFake((name: string) => {
            return name === "System.DefaultWorkingDirectory" ? workingDirectory : undefined;
        });
        featureStub = sandbox.stub(tl, "getPipelineFeature").returns(false);
        execStub = sandbox.stub().resolves(0);
        legacyExecStub = sandbox.stub(tl, "exec").callsFake(execStub);
        spawnStub = sandbox.stub(childProcess, "spawn").callsFake((tool, args, options) => {
            const child = Object.assign(new EventEmitter(), {
                stdout: new PassThrough(),
                stderr: new PassThrough()
            });
            execStub(tool, args, options).then(
                (code: number) => setImmediate(() => {
                    if (stdoutOutput) {
                        child.stdout.write(stdoutOutput);
                    }
                    if (stderrOutput) {
                        child.stderr.write(stderrOutput);
                    }
                    child.emit("close", code, exitSignal);
                }),
                (error: Error) => setImmediate(() => child.emit("error", error)));
            return child;
        });
        toolPathStub = sandbox.stub(msDeployUtility, "getMSDeployFullPath").resolves(regularToolPath);
        shortPathStub = sandbox.stub(msDeployUtility, "getSpaceSafeToolPath").throws(new Error("8.3 names unavailable"));
        sandbox.stub(utility, "isMSDeployPackage").resolves(false);
    });

    afterEach(() => {
        sandbox.restore();
        if (originalCompatibilityValue === undefined) {
            delete process.env[compatibilityEnvironmentVariable];
        } else {
            process.env[compatibilityEnvironmentVariable] = originalCompatibilityValue;
        }
        tl.rmRF(workingDirectory);
    });

    function stubSecureFlag(enabled: boolean, compatibilityEnabled?: boolean | string): void {
        if (compatibilityEnabled === undefined) {
            delete process.env[compatibilityEnvironmentVariable];
        } else {
            process.env[compatibilityEnvironmentVariable] = String(compatibilityEnabled);
        }
        featureStub.callsFake((feature: string) => {
            return feature === "SecureMSDeployCommandExecution" ? enabled
                : feature === WebDeploymentCompatibilityFixEnabled ? String(compatibilityEnabled).toLowerCase() === "true" : false;
        });
    }

    function deploy(packagePath: string, enabled: boolean, compatibilityEnabled: boolean | string | undefined,
        additionalArguments: string = null, setParametersFile: string = null): Promise<void> {
        stubSecureFlag(enabled, compatibilityEnabled);
        return DeployUsingMSDeploy(packagePath, "webapp_name", null, false, false, false, null,
            setParametersFile, additionalArguments, false, setParametersFile !== null);
    }

    function expectedArguments(packagePath: string): string[] {
        return ["-verb:sync", "-source:package='" + packagePath + "'", "-dest:contentPath='webapp_name'",
            "-enableRule:DoNotDeleteRule"];
    }

    function assertInvocation(expectedArgs: string[], secure: boolean, callIndex: number = 0): void {
        const [toolPath, args, rawOptions] = execStub.getCall(callIndex).args;
        const options = rawOptions as IExecOptions & childProcess.SpawnOptions;
        assert.strictEqual(toolPath, secure ? regularToolPath : "msdeploy");
        assert.deepStrictEqual(args, expectedArgs);
        if (secure) {
            assert.deepStrictEqual(Object.keys(options).sort(), ["argv0", "shell", "windowsVerbatimArguments"]);
            assert.strictEqual(options.argv0, '"' + regularToolPath + '"');
            assert.strictEqual(legacyExecStub.called, false);
            assert.strictEqual(spawnStub.callCount, execStub.callCount);
        } else {
            assert.deepStrictEqual(Object.keys(options).sort(), ["errStream", "failOnStdErr", "shell", "windowsVerbatimArguments"]);
            assert.strictEqual(options.failOnStdErr, true);
            assert.ok(options.errStream instanceof fs.WriteStream);
            assert.strictEqual(spawnStub.called, false);
        }
        assert.strictEqual(options.shell, !secure);
        assert.strictEqual(options.windowsVerbatimArguments, true);
        assert.strictEqual(shortPathStub.called, false, "execution must not depend on short paths or invoke cmd.exe to resolve them");
    }

    for (const executablePath of [regularToolPath, spacedToolPath, "C:\\Tools with `backticks\\msdeploy.exe",
        "C:\\Tools & %PATH% ! ^ (v1)\\msdeploy.exe"]) {
        it(`should use the original executable path '${executablePath}' without a shell or short-path conversion`, async () => {
            toolPathStub.resolves(executablePath);
            const packagePath = "C:\\Release Builds\\My App (Release Build) v1.0.zip";

            await deploy(packagePath, true, true);

            assert.strictEqual(execStub.calledOnce, true);
            assert.strictEqual(execStub.firstCall.args[0], executablePath);
            const options = execStub.firstCall.args[2] as childProcess.SpawnOptions;
            assert.deepStrictEqual(execStub.firstCall.args[1], expectedArguments(packagePath));
            assert.strictEqual(options.shell, false);
            assert.strictEqual(options.windowsVerbatimArguments, true);
            assert.strictEqual(options.argv0, '"' + executablePath + '"');
            assert.strictEqual(legacyExecStub.called, false);
            assert.strictEqual(spawnStub.calledOnce, true);
            assert.strictEqual(shortPathStub.called, false);
        });
    }

    it("should preserve the exact legacy executable, options and argument array when the flag is off", async () => {
        const packagePath = "C:\\Release Builds\\my package.zip";
        await deploy(packagePath, false, false, "-skip:objectName=filePath,absolutePath='C:\\My Site\\web.config'");

        assert.strictEqual(execStub.calledOnce, true);
        assertInvocation(["-verb:sync", "-source:package='" + packagePath + "'", "-dest:contentPath='webapp_name'",
            '-skip:objectName=filePath,absolutePath="C:\\My Site\\web.config"', "-enableRule:DoNotDeleteRule"], false);
    });

    it("should preserve complete profile, site, virtual application and additional arguments containing spaces and backticks", async () => {
        stubSecureFlag(true, true);
        const packagePath = "C:\\Release `Builds\\R&D 100%-release.zip";
        const profile = { publishUrl: "site.scm.azurewebsites.net:443", userName: "$site `user", userPWD: "pass `word" };
        await DeployUsingMSDeploy(packagePath, "my `site", profile, false, false, false, "virtual `app",
            null, "-setParam:name='Display Name',value='hello `world' -retryAttempts:11", false, false);

        assert.strictEqual(execStub.calledOnce, true);
        const expected = ["-verb:sync", "-source:package='" + packagePath + "'",
            "-dest:contentPath='my `site/virtual `app',ComputerName='https://site.scm.azurewebsites.net:443/msdeploy.axd?site=my `site'," +
            "UserName='$site `user',Password='pass `word',AuthType='Basic'",
            '-setParam:name="Display Name",value="hello `world"', "-retryAttempts:11", "-enableRule:DoNotDeleteRule"];
        assert.deepStrictEqual(execStub.firstCall.args[1], expected);
        assert.strictEqual(execStub.firstCall.args[0], regularToolPath);
        assert.strictEqual((execStub.firstCall.args[2] as IExecOptions).shell, false);
    });

    it("should preserve a connection string with spaces and commas as exactly one additional argument", async () => {
        const value = "Encrypt=True;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=my database;User Id=someuser;Password=p@ss;";
        await deploy("package.zip", true, true, "-setParam:name='ConnectionString',value='" + value + "'");

        assert.strictEqual(execStub.calledOnce, true);
        assert.deepStrictEqual(execStub.firstCall.args[1], ["-verb:sync", "-source:package='package.zip'",
            "-dest:contentPath='webapp_name'", '-setParam:name="ConnectionString",value="' + value + '"',
            "-enableRule:DoNotDeleteRule"]);
    });

    it("should preserve shell metacharacters literally in package paths and additional argument values", async () => {
        const packagePath = "C:\\Release Builds\\app & %PATH% ! ^ (v1) ; $ `build.zip";
        const value = "literal & %PATH% ! ^ | < > ; $ ` (value)";

        await deploy(packagePath, true, true, "-setParam:name='Display Name',value='" + value + "'");

        assert.strictEqual(execStub.calledOnce, true);
        assertInvocation(["-verb:sync", "-source:package='" + packagePath + "'", "-dest:contentPath='webapp_name'",
            '-setParam:name="Display Name",value="' + value + '"', "-enableRule:DoNotDeleteRule"], true);
    });

    it("should keep the secure user agent with spaces and backticks in one argument", async () => {
        stubSecureFlag(true, true);
        variableStub.withArgs("AZURE_HTTP_USER_AGENT").returns("my `user agent");
        await DeployUsingMSDeploy("package.zip", "site", {
            publishUrl: "site.scm.azurewebsites.net", userName: "user", userPWD: "password"
        }, false, false, false, null, null, null, false, false);

        assert.strictEqual(execStub.calledOnce, true);
        assertInvocation(["-verb:sync", "-source:package='package.zip'",
            "-dest:contentPath='site',ComputerName='https://site.scm.azurewebsites.net/msdeploy.axd?site=site'," +
            "UserName='user',Password='password',AuthType='Basic'",
            "-enableRule:DoNotDeleteRule", '-userAgent:"my `user agent"'], true);
    });

    for (const invalidPackage of ["app'payload.zip", 'app"payload.zip', "app\rpayload.zip", "app\npayload.zip"]) {
        it(`should reject an unsafe package value ${JSON.stringify(invalidPackage)} before executing`, async () => {
            await assert.rejects(deploy(invalidPackage, true, true), /quotes and newlines are not allowed/);
            assert.strictEqual(execStub.called, false);
        });
    }

    for (const newline of ["\r", "\n"]) {
        it(`should reject additional arguments containing ${JSON.stringify(newline)} before executing`, async () => {
            await assert.rejects(deploy("package.zip", true, true, "-setParam:name='name',value='one" + newline + "two'"),
                /newlines are not allowed/);
            assert.strictEqual(execStub.called, false);
        });
    }

    for (const failDeployment of [false, true]) {
        it(`should keep a copied parameter filename with spaces intact and clean up after ${failDeployment ? "exhausted retries" : "success"}`, async () => {
            const copiedFile = path.join(workingDirectory, "my `parameters.xml");
            fs.writeFileSync(copiedFile, "<parameters />");
            sandbox.stub(utility, "copySetParamFileIfItExists").returns(copiedFile);
            const originalPath = process.env.PATH;
            if (failDeployment) {
                execStub.rejects(new Error("deployment failed"));
                await assert.rejects(deploy("package.zip", true, true, null, "input.xml"), /deployment failed/);
            } else {
                execStub.onFirstCall().rejects(new Error("retryable failure"));
                await deploy("package.zip", true, true, null, "input.xml");
            }

            assert.strictEqual(execStub.callCount, failDeployment ? 3 : 2);
            for (const call of execStub.getCalls()) {
                assert.deepStrictEqual(call.args[1], ["-verb:sync", "-source:package='package.zip'",
                    "-dest:contentPath='webapp_name'", '-setParamFile="my `parameters.xml"', "-enableRule:DoNotDeleteRule"]);
                assert.strictEqual(call.args[0], regularToolPath);
                assert.strictEqual((call.args[2] as IExecOptions).shell, false);
                assert.strictEqual((call.args[2] as childProcess.SpawnOptions).windowsVerbatimArguments, true);
                assert.strictEqual((call.args[2] as childProcess.SpawnOptions).argv0, '"' + regularToolPath + '"');
            }
            assert.strictEqual(fs.existsSync(copiedFile), false);
            assert.strictEqual(process.env.PATH, originalPath);
        });
    }

    it("should clean up the parameter file and restore PATH when secure validation fails", async () => {
        const copiedFile = path.join(workingDirectory, "parameters.xml");
        fs.writeFileSync(copiedFile, "<parameters />");
        sandbox.stub(utility, "copySetParamFileIfItExists").returns(copiedFile);
        const originalPath = process.env.PATH;

        await assert.rejects(deploy("app'payload.zip", true, true, null, "input.xml"));

        assert.strictEqual(execStub.called, false);
        assert.strictEqual(fs.existsSync(copiedFile), false);
        assert.strictEqual(process.env.PATH, originalPath);
    });

    it("should leave the legacy parameter-file splitting and execution options unchanged", async () => {
        const copiedFile = path.join(workingDirectory, "my parameters.xml");
        fs.writeFileSync(copiedFile, "<parameters />");
        sandbox.stub(utility, "copySetParamFileIfItExists").returns(copiedFile);

        await deploy("package.zip", false, false, null, "input.xml");

        assert.strictEqual(execStub.calledOnce, true);
        assertInvocation(["-verb:sync", "-source:package='package.zip'", "-dest:contentPath='webapp_name'",
            "-setParamFile=my", "parameters.xml", "-enableRule:DoNotDeleteRule"], false);
        assert.strictEqual(fs.existsSync(copiedFile), false);
    });

    it("should keep a folder path ending in a backslash as a complete secure argument", async () => {
        stubSecureFlag(true, true);
        await DeployUsingMSDeploy("C:\\My `Site\\", "my `site", null, false, false, false,
            "my `application", null, null, true, true);

        assert.strictEqual(execStub.calledOnce, true);
        assertInvocation(["-verb:sync", "-source:IisApp='C:\\My `Site\\'",
            "-dest:iisApp='my `site/my `application'", "-enableRule:DoNotDeleteRule"], true);
    });

    it("should use the same secure execution options through executeWebDeploy", async () => {
        stubSecureFlag(true, true);
        toolPathStub.resolves(spacedToolPath);
        sandbox.stub(msDeployUtility, "getWebDeployArgumentsString").resolves(" -verb:sync -source:package=\"'my package.zip'\"");
        const originalPath = process.env.PATH;
        const result = await executeWebDeploy({ package: null, appName: "site" });

        assert.strictEqual(result.isSuccess, true);
        assert.strictEqual(execStub.firstCall.args[0], spacedToolPath);
        assert.deepStrictEqual(execStub.firstCall.args[1], ["-verb:sync", "-source:package='my package.zip'"]);
        assert.strictEqual((execStub.firstCall.args[2] as IExecOptions).shell, false);
        assert.strictEqual((execStub.firstCall.args[2] as childProcess.SpawnOptions).windowsVerbatimArguments, true);
        assert.strictEqual((execStub.firstCall.args[2] as childProcess.SpawnOptions).argv0, '"' + spacedToolPath + '"');
        assert.strictEqual(legacyExecStub.called, false);
        assert.strictEqual(shortPathStub.called, false);
        assert.strictEqual(process.env.PATH, originalPath);
    });

    it("should retain value-level quotes without outer argument quotes in the raw MSDeploy command line", async () => {
        stubSecureFlag(true, true);
        const source = path.join(workingDirectory, "source `folder & %PATH% with spaces");
        const parameters = path.join(workingDirectory, "parameters `file & %PATH% with spaces.xml");
        fs.mkdirSync(source);
        fs.writeFileSync(parameters, "<parameters />");

        const result = await executeWebDeploy({
            package: new Package(source),
            appName: "local `site",
            publishUrl: "localhost",
            userName: "unused",
            password: "unused",
            setParametersFile: parameters,
            additionalArguments: "-setParam:name='Display Name',value='literal `value & %PATH%'",
            useWebDeploy: true
        });

        assert.strictEqual(result.isSuccess, true);
        assertInvocation(["-verb:sync", "-source:IisApp='" + source + "'",
            "-dest:iisApp='local `site',ComputerName='https://localhost/msdeploy.axd?site=local `site'," +
            "UserName='unused',Password='unused',AuthType='Basic'",
            '-setParamFile="' + parameters + '"',
            '-setParam:name="Display Name",value="literal `value & %PATH%"', "-enableRule:DoNotDeleteRule"], true);
        const args = execStub.firstCall.args[1] as string[];
        assert.ok(args.every(arg => arg.startsWith("-")), "no whole argument may be wrapped in double quotes");
        assert.strictEqual(fs.existsSync(parameters), true, "executeWebDeploy does not own the supplied parameter file");
    });

    for (const entryPoint of ["DeployUsingMSDeploy", "executeWebDeploy"]) {
        it(`should forward secure stdout through ${entryPoint} without logging credential arguments`, async () => {
            stubSecureFlag(true, true);
            stdoutOutput = "MSDeploy output\n";
            const outputStub = sandbox.stub(process.stdout, "write").returns(true);
            const debugSpy = sandbox.spy(tl, "debug");
            const secret = "my-secret-password";
            const additional = "-setParam:name='Credential',value='" + secret + "',kind='TextFile'";

            if (entryPoint === "DeployUsingMSDeploy") {
                await DeployUsingMSDeploy("package.zip", "site", {
                    publishUrl: "localhost", userName: "user", userPWD: secret
                }, false, false, false, null, null, additional, false, false);
            } else {
                sandbox.stub(msDeployUtility, "getWebDeployArgumentsString").resolves(
                    ' -verb:sync -dest:auto,Password="' + secret + '"');
                const result = await executeWebDeploy({ package: null, appName: "site" });
                assert.strictEqual(result.isSuccess, true);
            }

            assert.ok(outputStub.getCalls().some(call =>
                Buffer.isBuffer(call.args[0]) && call.args[0].toString() === stdoutOutput));
            assert.strictEqual(debugSpy.getCalls().some(call => String(call.args[0]).includes(secret)), false);
            assert.strictEqual(spawnStub.calledOnce, true);
            assert.strictEqual(legacyExecStub.called, false);
        });

        for (const failure of ["stderr", "nonzero exit", "launch error", "signal"]) {
            it(`should preserve parameter ownership and restore PATH after ${failure} through ${entryPoint}`, async () => {
                const parameters = path.join(workingDirectory, "my `parameters.xml");
                fs.writeFileSync(parameters, "<parameters />");
                const originalPath = process.env.PATH;
                const debugSpy = sandbox.spy(tl, "debug");
                const secret = "launch-metadata-secret";
                if (failure === "stderr") {
                    stderrOutput = "ERROR_CERTIFICATE_VALIDATION_FAILED";
                } else if (failure === "nonzero exit") {
                    execStub.resolves(23);
                } else if (failure === "launch error") {
                    execStub.rejects(Object.assign(new Error("spawn ENOENT"), { spawnargs: [secret] }));
                } else {
                    execStub.resolves(null);
                    exitSignal = "SIGTERM";
                }

                if (entryPoint === "DeployUsingMSDeploy") {
                    sandbox.stub(utility, "copySetParamFileIfItExists").returns(parameters);
                    const expectedError = failure === "stderr" ? /MSDeploy wrote to stderr/
                        : failure === "nonzero exit" ? /MSDeploy exited with code 23/
                        : failure === "launch error" ? /spawn ENOENT/
                        : /MSDeploy was terminated by signal SIGTERM/;
                    await assert.rejects(deploy("package.zip", true, true, null, "input.xml"), expectedError);
                    assert.strictEqual(spawnStub.callCount, 3);
                    assert.strictEqual(fs.existsSync(parameters), false);
                } else {
                    stubSecureFlag(true, true);
                    sandbox.stub(msDeployUtility, "getWebDeployArgumentsString").resolves(" -verb:sync");
                    const result = await executeWebDeploy({ package: null, appName: "site", setParametersFile: parameters });
                    assert.strictEqual(result.isSuccess, false);
                    assert.strictEqual(result.error, stderrOutput);
                    assert.strictEqual(result.errorCode, stderrOutput);
                    assert.strictEqual(spawnStub.calledOnce, true);
                    assert.strictEqual(fs.existsSync(parameters), true);
                }
                assert.strictEqual(process.env.PATH, originalPath);
                assert.strictEqual(legacyExecStub.called, false);
                assert.strictEqual(shortPathStub.called, false);
                assert.strictEqual(debugSpy.getCalls().some(call => String(call.args[0]).includes(secret)), false);
            });
        }
    }

    for (const entryPoint of ["DeployUsingMSDeploy", "executeWebDeploy"]) {
        for (const secureEnabled of [false, true]) {
            for (const compatibilityEnabled of [undefined, "", false, true, "FALSE", "TrUe"]) {
                it(`should preserve ${entryPoint} rollout behavior with secure=${secureEnabled}, compatibility=${compatibilityEnabled}`, async () => {
                    stubSecureFlag(secureEnabled, compatibilityEnabled);
                    const fixesEnabled = secureEnabled && String(compatibilityEnabled).toLowerCase() !== "false";
                    const source = path.join(workingDirectory, "source folder");
                    const parameters = path.join(workingDirectory, "my parameters.xml");
                    fs.mkdirSync(source);
                    fs.writeFileSync(parameters, "<parameters />");
                    const shortToolPath = "C:\\PROGRA~1\\IIS\\MICROS~1\\msdeploy.exe";
                    toolPathStub.resolves(spacedToolPath);
                    shortPathStub.returns(shortToolPath);
                    variableStub.withArgs("AZURE_HTTP_USER_AGENT").returns("my user agent");
                    const profile = { publishUrl: "localhost", userName: "user", userPWD: "password" };
                    const originalPath = process.env.PATH;
                    const debugSpy = sandbox.spy(tl, "debug");

                    if (entryPoint === "DeployUsingMSDeploy") {
                        sandbox.stub(utility, "copySetParamFileIfItExists").returns(parameters);
                        await DeployUsingMSDeploy(source, "site", profile, false, false, false, null,
                            "input.xml", "-retryAttempts:11", true, true);
                    } else {
                        const result = await executeWebDeploy({
                            package: new Package(source), appName: "site",
                            publishUrl: profile.publishUrl, userName: profile.userName, password: profile.userPWD,
                            setParametersFile: parameters, additionalArguments: "-retryAttempts:11", useWebDeploy: true
                        });
                        assert.strictEqual(result.isSuccess, true);
                    }

                    const suppliedParameters = entryPoint === "DeployUsingMSDeploy" ? "my parameters.xml" : parameters;
                    const expectedParameterArgs = fixesEnabled ? ['-setParamFile="' + suppliedParameters + '"']
                        : ("-setParamFile=" + suppliedParameters).split(" ").filter(arg => arg.length > 0);
                    const expectedUserAgentArgs = fixesEnabled ? ['-userAgent:"my user agent"'] : ["-userAgent:my", "user", "agent"];
                    assert.strictEqual(execStub.calledOnce, true);
                    assert.deepStrictEqual(execStub.firstCall.args[1], [
                        "-verb:sync", "-source:IisApp='" + source + "'",
                        "-dest:iisApp='site',ComputerName='https://localhost/msdeploy.axd?site=site'," +
                        "UserName='user',Password='password',AuthType='Basic'",
                        ...expectedParameterArgs, "-retryAttempts:11", "-enableRule:DoNotDeleteRule", ...expectedUserAgentArgs
                    ]);
                    if (fixesEnabled) {
                        assert.strictEqual(spawnStub.calledOnce, true);
                        assert.strictEqual(legacyExecStub.called, false);
                        assert.strictEqual(shortPathStub.called, false);
                        assert.strictEqual(execStub.firstCall.args[0], spacedToolPath);
                        assert.deepStrictEqual(execStub.firstCall.args[2], {
                            argv0: '"' + spacedToolPath + '"', windowsVerbatimArguments: true, shell: false
                        });
                    } else {
                        assert.strictEqual(spawnStub.called, false);
                        assert.strictEqual(legacyExecStub.calledOnce, true);
                        assert.strictEqual(execStub.firstCall.args[0], secureEnabled ? shortToolPath : "msdeploy");
                        const options = execStub.firstCall.args[2] as IExecOptions;
                        assert.deepStrictEqual(Object.keys(options).sort(), secureEnabled
                            ? ["errStream", "failOnStdErr", "windowsVerbatimArguments"]
                            : ["errStream", "failOnStdErr", "shell", "windowsVerbatimArguments"]);
                        assert.strictEqual(options.failOnStdErr, true);
                        assert.strictEqual(options.windowsVerbatimArguments, true);
                        assert.strictEqual(options.shell, secureEnabled ? undefined : true);
                        assert.ok(options.errStream instanceof fs.WriteStream);
                        assert.strictEqual(shortPathStub.calledOnce, secureEnabled);
                        if (secureEnabled) {
                            assert.deepStrictEqual(shortPathStub.firstCall.args, [spacedToolPath]);
                        }
                    }
                    assert.strictEqual(debugSpy.calledWith("the argument string is:"), !fixesEnabled);
                    assert.strictEqual(process.env.PATH, originalPath);
                    assert.strictEqual(fs.existsSync(parameters), entryPoint === "executeWebDeploy");
                });
            }
        }
    }

    for (const entryPoint of ["DeployUsingMSDeploy", "executeWebDeploy"]) {
        for (const invalidValue of ["invalid", "1", " true", "false ", " "]) {
            it(`should reject invalid compatibility configuration ${JSON.stringify(invalidValue)} before executing ${entryPoint}`, async () => {
                stubSecureFlag(true, invalidValue);
                sandbox.stub(tl, "loc").callsFake((key: string) => key);
                const source = path.join(workingDirectory, "source folder");
                const parameters = path.join(workingDirectory, "my parameters.xml");
                fs.mkdirSync(source);
                fs.writeFileSync(parameters, "<parameters />");
                const originalPath = process.env.PATH;
                let deployment: Promise<unknown>;

                if (entryPoint === "DeployUsingMSDeploy") {
                    sandbox.stub(utility, "copySetParamFileIfItExists").returns(parameters);
                    deployment = DeployUsingMSDeploy(source, "site", null, false, false, false, null,
                        "input.xml", null, true, true);
                } else {
                    deployment = executeWebDeploy({
                        package: new Package(source), appName: "site", setParametersFile: parameters, useWebDeploy: true
                    });
                }

                await assert.rejects(deployment, /WebDeploymentInvalidCompatibilityFlag/);

                assert.strictEqual(execStub.called, false);
                assert.strictEqual(spawnStub.called, false);
                assert.strictEqual(legacyExecStub.called, false);
                assert.strictEqual(shortPathStub.called, false);
                assert.strictEqual(featureStub.calledWith(WebDeploymentCompatibilityFixEnabled), false);
                assert.strictEqual(process.env.PATH, originalPath);
                assert.strictEqual(fs.existsSync(parameters), entryPoint === "executeWebDeploy");
            });

            it(`should preserve legacy transport through ${entryPoint} with invalid compatibility configuration ${JSON.stringify(invalidValue)}`, async () => {
                stubSecureFlag(false, invalidValue);
                if (entryPoint === "DeployUsingMSDeploy") {
                    await deploy("package.zip", false, invalidValue);
                } else {
                    sandbox.stub(msDeployUtility, "getWebDeployArgumentsString").resolves(
                        expectedArguments("package.zip").join(" "));
                    const result = await executeWebDeploy({ package: null, appName: "webapp_name" });
                    assert.strictEqual(result.isSuccess, true);
                }

                assert.strictEqual(execStub.calledOnce, true);
                assertInvocation(expectedArguments("package.zip"), false);
                assert.strictEqual(featureStub.calledWith(WebDeploymentCompatibilityFixEnabled), false);
            });
        }

        it(`should read compatibility configuration for every ${entryPoint} invocation`, async () => {
            shortPathStub.returns(regularToolPath);
            if (entryPoint === "executeWebDeploy") {
                sandbox.stub(msDeployUtility, "getWebDeployArgumentsString").resolves(
                    expectedArguments("package.zip").join(" "));
            }
            const values = [false, true, undefined, "", false];
            const originalPath = process.env.PATH;

            for (let i = 0; i < values.length; i++) {
                stubSecureFlag(true, values[i]);
                if (entryPoint === "DeployUsingMSDeploy") {
                    await deploy("package.zip", true, values[i]);
                } else {
                    const result = await executeWebDeploy({ package: null, appName: "webapp_name" });
                    assert.strictEqual(result.isSuccess, true);
                }

                const [toolPath, args, options] = execStub.getCall(i).args;
                assert.strictEqual(toolPath, regularToolPath);
                assert.deepStrictEqual(args, expectedArguments("package.zip"));
                if (values[i] === false) {
                    assert.deepStrictEqual(Object.keys(options).sort(), ["errStream", "failOnStdErr", "windowsVerbatimArguments"]);
                    assert.strictEqual(options.windowsVerbatimArguments, true);
                    assert.strictEqual(options.failOnStdErr, true);
                    assert.strictEqual(options.shell, undefined);
                    assert.ok(options.errStream instanceof fs.WriteStream);
                } else {
                    assert.deepStrictEqual(options, {
                        argv0: '"' + regularToolPath + '"', windowsVerbatimArguments: true, shell: false
                    });
                }
                assert.strictEqual(process.env.PATH, originalPath);
            }

            assert.strictEqual(execStub.callCount, 5);
            assert.strictEqual(spawnStub.callCount, 3);
            assert.strictEqual(legacyExecStub.callCount, 2);
            assert.strictEqual(shortPathStub.callCount, 2);
        });
    }

    for (const compatibilityEnabled of [false, "FALSE"]) {
        it(`should leave published executable-path validation unchanged with compatibility=${compatibilityEnabled}`, async () => {
            const toolPath = 'C:\\Bad"Path\r\n\\msdeploy.exe';
            toolPathStub.resolves(toolPath);
            shortPathStub.returns(toolPath);

            await deploy("package.zip", true, compatibilityEnabled);

            assert.strictEqual(legacyExecStub.calledOnce, true);
            assert.strictEqual(legacyExecStub.firstCall.args[0], toolPath);
            assert.deepStrictEqual(legacyExecStub.firstCall.args[1], expectedArguments("package.zip"));
            const options = legacyExecStub.firstCall.args[2] as IExecOptions;
            assert.deepStrictEqual(Object.keys(options).sort(), ["errStream", "failOnStdErr", "windowsVerbatimArguments"]);
            assert.strictEqual(options.shell, undefined);
            assert.strictEqual(options.windowsVerbatimArguments, true);
            assert.strictEqual(options.failOnStdErr, true);
            assert.strictEqual(spawnStub.called, false);
        });

        it(`should preserve the published secure fail-closed error and telemetry with compatibility=${compatibilityEnabled}`, async () => {
            toolPathStub.resolves(spacedToolPath);
            shortPathStub.returns(spacedToolPath);
            const logStub = sandbox.stub(console, "log");
            const originalPath = process.env.PATH;
            const expectedError = "Secure MSDeploy execution could not resolve a space-free path for msdeploy.exe. " +
                "The deployment was stopped instead of falling back to shell-based execution.";

            await assert.rejects(deploy("package.zip", true, compatibilityEnabled),
                (error: Error) => error.message === expectedError);

            assert.strictEqual(spawnStub.called, false);
            assert.strictEqual(legacyExecStub.called, false);
            assert.strictEqual(execStub.called, false);
            assert.strictEqual(shortPathStub.callCount, 3);
            const telemetry = '##vso[telemetry.publish area=TaskHub;feature=AzureRmWebAppDeployment]' +
                '{"event":"SecureMSDeployCommandExecution","outcome":"SpaceFreeToolPathUnavailable"}';
            assert.strictEqual(logStub.getCalls().filter(call => call.args[0] === telemetry).length, 3);
            assert.strictEqual(process.env.PATH, originalPath);
        });
    }

    for (const toolPath of ['C:\\Bad"Path\\msdeploy.exe', "C:\\Bad\rPath\\msdeploy.exe", "C:\\Bad\nPath\\msdeploy.exe"]) {
        it(`should reject an unsafe argv0 path ${JSON.stringify(toolPath)} before spawning`, async () => {
            toolPathStub.resolves(toolPath);

            await assert.rejects(deploy("package.zip", true, true), /Invalid character in MSDeploy executable path/);

            assert.strictEqual(spawnStub.called, false);
            assert.strictEqual(legacyExecStub.called, false);
        });
    }
}
