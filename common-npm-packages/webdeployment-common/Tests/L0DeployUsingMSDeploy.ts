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

    it("should pass a maliciously named package as a single argument and never invoke a shell when the secure flag is on", async () => {
        // Package name mimics a shell command-chaining payload (CWE-78 class) that a
        // customer-controlled artifact filename could contain.
        const maliciousPackageName = "app&calc&payload.zip";
        const maliciousPackagePath = path.join(workingDirectory, maliciousPackageName);
        fs.writeFileSync(maliciousPackagePath, "");

        await deploy(maliciousPackagePath, true);

        assert.strictEqual(execStub.calledOnce, true);
        const [toolPath, argsArray, options] = execStub.firstCall.args;

        // No shell should be involved: metacharacters in the package name must not be
        // able to reach cmd.exe for interpretation.
        assert.strictEqual((options as any).shell, undefined, "shell option must not be enabled when the secure flag is on");
        assert.strictEqual((options as any).windowsVerbatimArguments, undefined, "windowsVerbatimArguments must not be enabled when the secure flag is on");
        assert.notStrictEqual(toolPath, "msdeploy", "the absolute msdeploy path should be used, not a PATH-resolved name");
        assert.ok(toolPath.toLowerCase().endsWith("msdeploy.exe"), "toolPath should point at msdeploy.exe");

        // The malicious filename must survive as a single argv element containing the
        // full path, not be split apart or otherwise cause extra tokens to appear.
        const packageArg = argsArray.find((a: string) => a.indexOf(maliciousPackageName) !== -1);
        assert.ok(packageArg, "expected an argument containing the package path");
        assert.strictEqual(
            argsArray.filter((a: string) => a.indexOf("calc") !== -1).length,
            1,
            "the injected token must appear in exactly one argument, never split into its own argv entry"
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

    it("should keep a package path containing spaces as a single argument", async () => {
        const packagePath = path.join(workingDirectory, "my package.zip");
        fs.writeFileSync(packagePath, "");

        await deploy(packagePath, true);

        const [, argsArray] = execStub.firstCall.args;
        const packageArg = argsArray.find((a: string) => a.indexOf("my package.zip") !== -1);
        assert.ok(packageArg, "package path with a space should remain intact within a single argument");
    });
}
