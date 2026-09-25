import assert = require("assert");
import fs = require("fs");
import os = require("os");
import path = require("path");
import sinon = require("sinon");
import tl = require("azure-pipelines-task-lib/task");
import utility = require("../utility");

import { DeployUsingMSDeploy } from "../deployusingmsdeploy";

export function runDeployUsingMSDeployTests(): void {

    let sandbox: sinon.SinonSandbox;
    let execStub: sinon.SinonStub;
    let workingDirectory: string;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "msdeploy-test-"));
        sandbox.stub(tl, "getVariable").callsFake((name: string) => {
            return name === "System.DefaultWorkingDirectory" ? workingDirectory : undefined;
        });
        execStub = sandbox.stub(tl, "exec").resolves(0);
        sandbox.stub(utility, "isMSDeployPackage").resolves(false);
    });

    afterEach(() => {
        sandbox.restore();
        tl.rmRF(workingDirectory);
    });

    function deploy(webDeployPkg: string, secureInvocationEnabled: boolean): Promise<void> {
        sandbox.stub(tl, "getPipelineFeature").callsFake((feature: string) => {
            return feature === "SecureMSDeployCommandExecution" ? secureInvocationEnabled : false;
        });
        return DeployUsingMSDeploy(webDeployPkg, "webapp_name", null, false, false, false, null, null, null, false, false);
    }

    it("should pass a package name containing spaces and parentheses as a single argument and never invoke a shell when the secure flag is on", async () => {
        const trickyPackageName = "My App (Release Build) v1.0.zip";
        const trickyPackagePath = path.join(workingDirectory, trickyPackageName);
        fs.writeFileSync(trickyPackagePath, "");

        await deploy(trickyPackagePath, true);

        assert.strictEqual(execStub.calledOnce, true);
        const [toolPath, argsArray, options] = execStub.firstCall.args;

        assert.strictEqual((options as any).shell, undefined, "shell option must not be enabled when the secure flag is on");
        assert.strictEqual((options as any).windowsVerbatimArguments, true, "windowsVerbatimArguments must stay enabled so msdeploy's own argument parsing is unaffected");
        assert.notStrictEqual(toolPath, "msdeploy", "the absolute msdeploy path should be used, not a PATH-resolved name");
        assert.ok(toolPath.toLowerCase().endsWith("msdeploy.exe"), "toolPath should point at msdeploy.exe");

        const packageArg = argsArray.find((a: string) => a.indexOf(trickyPackageName) !== -1);
        assert.ok(packageArg, "expected an argument containing the package path");
        assert.strictEqual(
            argsArray.filter((a: string) => a.indexOf("Release Build") !== -1).length,
            1,
            "the name must appear in exactly one argument, never split into its own argv entry"
        );
    });

    it("should still invoke via a shell with the PATH-resolved tool name when the secure flag is off (legacy behavior preserved)", async () => {
        const packagePath = path.join(workingDirectory, "package.zip");
        fs.writeFileSync(packagePath, "");

        await deploy(packagePath, false);

        assert.strictEqual(execStub.calledOnce, true);
        const [toolPath, , options] = execStub.firstCall.args;

        assert.strictEqual((options as any).shell, true);
        assert.strictEqual((options as any).windowsVerbatimArguments, true);
        assert.strictEqual(toolPath, "msdeploy");
    });

    it("should reject a package name containing a quote character when the secure flag is on", async () => {
        const maliciousPackageName = "app'payload.zip";
        const maliciousPackagePath = path.join(workingDirectory, maliciousPackageName);
        fs.writeFileSync(maliciousPackagePath, "");

        await assert.rejects(deploy(maliciousPackagePath, true));
        assert.strictEqual(execStub.called, false, "msdeploy should never be invoked when input validation rejects the package path");
    });

    it("should allow a package name containing legitimate shell metacharacters when the secure flag is on", async () => {
        const packageName = "R&D 100%-release.zip";
        const packagePath = path.join(workingDirectory, packageName);
        fs.writeFileSync(packagePath, "");

        await deploy(packagePath, true);

        assert.strictEqual(execStub.calledOnce, true);
        const [, argsArray] = execStub.firstCall.args;
        const packageArg = argsArray.find((a: string) => a.indexOf(packageName) !== -1);
        assert.ok(packageArg, "package path containing '&' and '%' should not be rejected and should remain intact");
    });

    it("should keep a package path containing spaces as a single argument", async () => {
        const packagePath = path.join(workingDirectory, "my package.zip");
        fs.writeFileSync(packagePath, "");

        await deploy(packagePath, true);

        const [, argsArray] = execStub.firstCall.args;
        const packageArg = argsArray.find((a: string) => a.indexOf("my package.zip") !== -1);
        assert.ok(packageArg, "package path with a space should remain intact within a single argument");
    });

    it("should pass a connection-string additionalArguments value through to msdeploy intact as a single argument (shell:false)", async () => {
        const packagePath = path.join(workingDirectory, "package.zip");
        fs.writeFileSync(packagePath, "");

        const additionalArguments =
            "-setParam:name='ConnectionString',value='Encrypt=True;TrustServerCertificate=False;" +
            "Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;" +
            "User Id=someuser;Password=P@ss;'";

        sandbox.stub(tl, "getPipelineFeature").callsFake((feature: string) => {
            return feature === "SecureMSDeployCommandExecution" ? true : false;
        });
        await DeployUsingMSDeploy(packagePath, "webapp_name", null, false, false, false, null, null,
            additionalArguments, false, false);

        assert.strictEqual(execStub.calledOnce, true);
        const [, argsArray, options] = execStub.firstCall.args;
        assert.strictEqual((options as any).shell, undefined, "shell option must not be enabled when the secure flag is on");
        assert.strictEqual((options as any).windowsVerbatimArguments, true);

        const setParamArg = argsArray.find((a: string) => a.indexOf("-setParam:name=") !== -1);
        assert.ok(setParamArg, "expected a -setParam argument to be present");
        assert.strictEqual(
            argsArray.filter((a: string) => a.indexOf("ConnectionString") !== -1).length,
            1,
            "the connection string must remain a single argv entry, never split at its embedded characters"
        );
        assert.ok(setParamArg.indexOf("Password=P@ss;") !== -1, "the connection string value must not be truncated");
        assert.ok(!/\\$/.test(setParamArg), "the argument must not end with a stray trailing backslash");
    });
}
