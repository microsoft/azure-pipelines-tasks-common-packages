import assert = require("assert");
import sinon = require("sinon");
import tl = require("azure-pipelines-task-lib/task");
import fs = require("fs");
import os = require("os");
import path = require("path");
import { getMSDeployCmdArgs, getWebDeployErrorCode, getSpaceSafeToolPath } from "../msdeployutility";
import { WebDeploymentCompatibilityFixEnabled } from "../featureFlags";

export function runGetMSDeployCmdArgsTests() {
    it('Should produce default valid args', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, true, false, true, null, null, null, true, false, false);

        const expectedArgs = [
            "-source:package=\"'package.zip'\"",
            "-dest:auto,ComputerName=\"'https://http://webapp_name.scm.azurewebsites.net:443/msdeploy.axd?site=webapp_name'\",UserName=\"'$webapp_name'\",Password=\"'webapp_password'\",AuthType=\"'Basic'\"",
            "-setParam:name=\"'IIS Web Application Name'\",value=\"'webapp_name'\"",
            "-enableRule:AppOffline"];

        const notExpectedArgs = ["-setParamFile"];

        checkParametersIfPresent(args, expectedArgs);
        checkParametersNotPresent(args, notExpectedArgs);
    });


    it('Should produce valid args with token auth', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, true, false, true, null, null, null, true, false, false, "Bearer");
        checkParametersIfPresent(args, ["AuthType=\"'Bearer'\""]);
    });


    it('Should produce valid args with parameter file', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, false, true, null, 'temp_param.xml', null, false, false, true);

        const expectedArgs = ['-setParamFile=temp_param.xml', "-dest:contentPath=\"'webapp_name'\"", '-enableRule:DoNotDelete'];
        checkParametersIfPresent(args, expectedArgs);
    });


    it('Should produce valid args with folder package', () => {

        const profile = createDefaultPublishProfile();
        const args: string = getMSDeployCmdArgs('c:/package/folder', 'webapp_name', profile, true, false, true, null, null, null, true, true, true);

        const expectedArgs = [
            "-source:IisApp=\"'c:/package/folder'\"",
            " -dest:iisApp=\"'webapp_name'\""
        ];
        checkParametersIfPresent(args, expectedArgs);
    });


    it('Should produce valid args with exclude data', () => {
        const profile = createDefaultPublishProfile();
        const args: string = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, null, false, false, true);

        checkParametersIfPresent(args, ['-skip:Directory=App_Data']);
    });


    it("Should produce valid args with war file", () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.war', 'webapp_name', profile, false, true, true, null, null, null, false, false, true);

        checkParametersIfPresent(args, [
            " -source:contentPath=\"'package.war'\"",
            " -dest:contentPath=\"'/site/webapps/package.war'\""
        ]);
    });

    it("Should override retry arguments", () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '-retryAttempts:11 -retryInterval:5000', false, false, true);

        checkParametersIfPresent(args, ['-retryAttempts:11', '-retryInterval:5000']);
    });
    it('Should encode connection strings correctly', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '"-retryAttempts:11 -retryInterval:5000 -setParam:name=\'ConnectionString\',value=\'Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\'', false, false, true);
        checkParametersIfPresent(args, ['-retryAttempts:11', '-retryInterval:5000', '-setParam:name="\"ConnectionString\"",value="\"Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\""']);
        const CSstring = '-setParam:name="\\"ConnectionString\\"",value="\\"Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\\""';
        assert.ok(args.includes(CSstring));
    });
    it('Should encrypt skip directives correctly', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '-skip:objectName=filePath,absolutePath="\\web\.config"', false, false, true);
        const skipsubstring = '-skip:objectName=filePath,absolutePath="\\"\\web.config\\""';
        checkParametersIfPresent(args, ['-skip:objectName=filePath,absolutePath="\\"\\web.config\\""']);
        assert.ok(args.includes(skipsubstring));
    });
    it('Should encrypt skip directives in-correctly', () => {
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '"-retryAttempts:11 -retryInterval:5000 -setParam:name=\'ConnectionString\',value=\'Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\' -skip:objectName=filePath data source,absolutePath="\\web\.config"', false, false, true);
        assert.ok(!args.includes('-skip:objectName=filePath data source,absolutePath="\\web.config"'));
    });

    function checkParametersIfPresent(argumentString: string, argumentCheckArray: string[]): void {
        for (const argument of argumentCheckArray) {
            if (argumentString.indexOf(argument) === -1) {
                assert.strictEqual(argumentString.indexOf(argument), -1, `Argument ${argument} not found in ${argumentString}`);
            }
        }
    }

    function checkParametersNotPresent(argumentString: string, argumentCheckArray: string[]): void {
        for (var argument of argumentCheckArray) {
            if (argumentString.indexOf(argument) !== -1) {
                assert.strictEqual(argumentString.indexOf(argument), -1, `Argument ${argument} found in ${argumentString}`);
            }
        }
    }

    function createDefaultPublishProfile(): { publishUrl: string, userName: string, userPWD: string } {
        return {
            publishUrl: 'http://webapp_name.scm.azurewebsites.net:443',
            userName: '$webapp_name',
            userPWD: 'webapp_password'
        };
    }
}

export function runGetWebDeployErrorCodeTests(): void {
    it("Should return proper error messages", () => {

        const errorMessages = {
            'ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER': 'ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER',
            "An error was encountered when processing operation 'Delete Directory' on 'D:\\home\\site\\wwwroot\\app_data\\jobs\\continous'": "WebJobsInProgressIssue",
            "Cannot delete file main.dll. Error code: FILE_IN_USE": "FILE_IN_USE",
            "transport connection": "transport connection",
            "error code: ERROR_CONNECTION_TERMINATED": "ERROR_CONNECTION_TERMINATED"
        }

        for (var errorMessage in errorMessages) {
            assert.strictEqual(getWebDeployErrorCode(errorMessage), errorMessages[errorMessage]);
        }
    });
}

export function runSecureMSDeployValidationTests(): void {
    let sandbox: sinon.SinonSandbox;
    let featureStub: sinon.SinonStub;
    let originalCompatibilityValue: string | undefined;
    const compatibilityEnvironmentVariable = "DISTRIBUTEDTASK_TASKS_" + WebDeploymentCompatibilityFixEnabled.toUpperCase();

    beforeEach(() => {
        originalCompatibilityValue = process.env[compatibilityEnvironmentVariable];
        delete process.env[compatibilityEnvironmentVariable];
        sandbox = sinon.createSandbox();
        featureStub = sandbox.stub(tl, "getPipelineFeature").returns(false);
    });

    afterEach(() => {
        sandbox.restore();
        if (originalCompatibilityValue === undefined) {
            delete process.env[compatibilityEnvironmentVariable];
        } else {
            process.env[compatibilityEnvironmentVariable] = originalCompatibilityValue;
        }
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

    const unsafeValues = ["it's", '"quoted"', "a\nb", "a\rb"];

    for (const unsafeValue of unsafeValues) {
        it(`should reject package path containing '${unsafeValue}' when the secure flag is on`, () => {
            stubSecureFlag(true, true);
            assert.throws(() => {
                getMSDeployCmdArgs(unsafeValue, 'webapp_name', null, false, false, false, null, null, null, false, false, false);
            });
        });
    }

    const legitimateValues = ["my package (v1)-final.zip", "R&D 100%-release.zip", "a`b.zip", "a|b.zip", "a;b.zip", "a$b.zip", "a<b.zip", "a>b.zip", "a^b.zip"];

    for (const legitimateValue of legitimateValues) {
        it(`should not reject package path containing '${legitimateValue}' when the secure flag is on`, () => {
            stubSecureFlag(true, true);
            assert.doesNotThrow(() => {
                getMSDeployCmdArgs(legitimateValue, 'webapp_name', null, false, false, false, null, null, null, false, false, false);
            });
        });
    }

    it("should reject a publish profile containing a quote character when the secure flag is on", () => {
        stubSecureFlag(true, true);
        const profile = { publishUrl: "webapp.scm.azurewebsites.net", userName: "it's-me", userPWD: "P@ss" };
        assert.throws(() => {
            getMSDeployCmdArgs("package.zip", 'webapp_name', profile, false, false, false, null, null, null, false, false, false);
        });
    });

    it("should not perform validation when the secure flag is off", () => {
        stubSecureFlag(false);
        for (const value of unsafeValues.concat(["a`b.zip", "a&b.zip"])) {
            const args = getMSDeployCmdArgs(value, 'webapp_name', null, false, false, false, null, null, null, false, false, false);
            assert.strictEqual(args, " -verb:sync -source:package=\"'" + value +
                "'\" -dest:contentPath=\"'webapp_name'\"   -enableRule:DoNotDeleteRule");
        }
    });

    for (const unsafeValue of unsafeValues) {
        for (const field of ["appName", "virtualApplication", "setParametersFile", "publishUrl", "userName", "userPWD", "authType"]) {
            it(`should reject ${JSON.stringify(unsafeValue)} in ${field} when the secure flag is on`, () => {
                stubSecureFlag(true, true);
                const values = {
                    appName: "webapp_name",
                    virtualApplication: "application",
                    setParametersFile: "parameters.xml",
                    publishUrl: "webapp.scm.azurewebsites.net",
                    userName: "user",
                    userPWD: "password",
                    authType: "Basic"
                };
                values[field as keyof typeof values] = unsafeValue;
                assert.throws(() => getMSDeployCmdArgs("package.zip", values.appName, {
                    publishUrl: values.publishUrl, userName: values.userName, userPWD: values.userPWD
                }, false, false, false, values.virtualApplication, values.setParametersFile, null, false, false, true,
                values.authType), /quotes and newlines are not allowed/);
            });
        }
    }

    it("should quote a secure parameter filename containing spaces and preserve backticks", () => {
        stubSecureFlag(true, true);
        const args = getMSDeployCmdArgs("my `package.zip", "my `site", null, false, false, false,
            "my `application", "my `parameters.xml", null, false, false, true);
        assert.strictEqual(args, " -verb:sync -source:package=\"'my `package.zip'\" " +
            "-dest:contentPath=\"'my `site/my `application'\" -setParamFile=\"\\\"my `parameters.xml\\\"\"    -enableRule:DoNotDeleteRule");
    });

    it("should preserve the exact legacy command string with a spaced parameter filename", () => {
        stubSecureFlag(false);
        const args = getMSDeployCmdArgs("my package.zip", "my site", null, false, false, false,
            "my application", "my parameters.xml", "-retryAttempts:11", false, false, true);
        assert.strictEqual(args, " -verb:sync -source:package=\"'my package.zip'\" " +
            "-dest:contentPath=\"'my site/my application'\" -setParamFile=my parameters.xml  -retryAttempts:11 -enableRule:DoNotDeleteRule");
    });

    for (const newline of ["\r", "\n"]) {
        it(`should reject ${JSON.stringify(newline)} in additional arguments when the secure flag is on`, () => {
            stubSecureFlag(true, true);
            assert.throws(() => getMSDeployCmdArgs("package.zip", "site", null, false, false, false,
                null, null, "-setParam:name='name',value='a" + newline + "b'", false, false, false),
            /newlines are not allowed/);
        });
    }

    it("should keep a secure user agent containing spaces in a quoted argument", () => {
        stubSecureFlag(true, true);
        sandbox.stub(tl, "getVariable").withArgs("AZURE_HTTP_USER_AGENT").returns("my `user agent");
        const args = getMSDeployCmdArgs("package.zip", "site", {
            publishUrl: "site.scm.azurewebsites.net", userName: "user", userPWD: "password"
        }, false, false, false, null, null, null, false, false, false);
        assert.ok(args.endsWith(' -userAgent:"\\"my `user agent\\""'));
    });

    for (const unsafeValue of unsafeValues) {
        it(`should reject ${JSON.stringify(unsafeValue)} in the secure user agent`, () => {
            stubSecureFlag(true, true);
            sandbox.stub(tl, "getVariable").withArgs("AZURE_HTTP_USER_AGENT").returns(unsafeValue);
            assert.throws(() => getMSDeployCmdArgs("package.zip", "site", {
                publishUrl: "site.scm.azurewebsites.net", userName: "user", userPWD: "password"
            }, false, false, false, null, null, null, false, false, false),
            /quotes and newlines are not allowed/);
        });
    }

    for (const secureEnabled of [false, true]) {
        for (const compatibilityEnabled of [undefined, "", false, true, "FALSE", "TrUe"]) {
            it(`should preserve the command and validation rollout matrix with secure=${secureEnabled}, compatibility=${compatibilityEnabled}`, () => {
                stubSecureFlag(secureEnabled, compatibilityEnabled);
                const fixesEnabled = secureEnabled && String(compatibilityEnabled).toLowerCase() !== "false";
                const userAgentStub = sandbox.stub(tl, "getVariable").withArgs("AZURE_HTTP_USER_AGENT").returns("my user agent");
                const profile = { publishUrl: "localhost", userName: "user", userPWD: "password" };
                function buildArgs(authType: string = "Basic", additional: string = "-retryAttempts:11"): string {
                    return getMSDeployCmdArgs("package.zip", "site", profile, false, false, false,
                        null, "my parameters.xml", additional, false, false, true, authType);
                }
                const prefix = " -verb:sync -source:package=\"'package.zip'\" -dest:contentPath=\"'site'\"," +
                    "ComputerName=\"'https://localhost/msdeploy.axd?site=site'\",UserName=\"'user'\"," +
                    "Password=\"'password'\",AuthType=\"'Basic'\"";
                const expected = prefix + (fixesEnabled
                    ? ' -setParamFile="\\"my parameters.xml\\""'
                    : " -setParamFile=my parameters.xml") +
                    "  -retryAttempts:11 -enableRule:DoNotDeleteRule" +
                    (fixesEnabled ? ' -userAgent:"\\"my user agent\\""' : " -userAgent:my user agent");
                assert.strictEqual(buildArgs(), expected);

                const backtickArgs = () => getMSDeployCmdArgs("my `package.zip", "site", null, false, false,
                    false, null, null, null, false, false, false);
                if (secureEnabled && !fixesEnabled) {
                    assert.throws(backtickArgs, /quotes and newlines are not allowed/);
                } else {
                    assert.strictEqual(backtickArgs(), " -verb:sync -source:package=\"'my `package.zip'\" " +
                        "-dest:contentPath=\"'site'\"   -enableRule:DoNotDeleteRule");
                }

                for (const unsafeValue of unsafeValues) {
                    const unsafePackageArgs = () => getMSDeployCmdArgs(unsafeValue, "site", null, false, false,
                        false, null, null, null, false, false, false);
                    if (secureEnabled) {
                        assert.throws(unsafePackageArgs, /quotes and newlines are not allowed/);
                    } else {
                        assert.doesNotThrow(unsafePackageArgs);
                    }
                    if (fixesEnabled) {
                        assert.throws(() => buildArgs(unsafeValue), /quotes and newlines are not allowed/);
                    } else {
                        assert.ok(buildArgs(unsafeValue).includes("AuthType=\"'" + unsafeValue + "'\""));
                    }
                    userAgentStub.returns(unsafeValue);
                    if (fixesEnabled) {
                        assert.throws(() => buildArgs(), /quotes and newlines are not allowed/);
                    } else {
                        assert.ok(buildArgs().endsWith(" -userAgent:" + unsafeValue));
                    }
                    userAgentStub.returns("my user agent");
                }
                for (const newline of ["\r", "\n"]) {
                    if (fixesEnabled) {
                        assert.throws(() => buildArgs("Basic", "-retryAttempts:11" + newline), /newlines are not allowed/);
                    } else {
                        assert.ok(buildArgs("Basic", "-retryAttempts:11" + newline).includes("-retryAttempts:11" + newline));
                    }
                }

                const debugSpy = sandbox.spy(tl, "debug");
                const secret = "compatibility-log-probe";
                buildArgs("Basic", "-setParam:name='Credential',value='" + secret + "',kind='TextFile'");
                assert.strictEqual(debugSpy.getCalls().some(call => String(call.args[0]).includes(secret)), !fixesEnabled);
            });
        }
    }

    it("should read compatibility flags at call time rather than caching them at module load", () => {
        const buildArgs = () => getMSDeployCmdArgs("my `package.zip", "site", null,
            false, false, false, null, null, null, false, false, false);
        stubSecureFlag(true, false);
        assert.throws(buildArgs);
        stubSecureFlag(true, true);
        assert.doesNotThrow(buildArgs);
        stubSecureFlag(true);
        assert.doesNotThrow(buildArgs);
        stubSecureFlag(true, "");
        assert.doesNotThrow(buildArgs);
        stubSecureFlag(true, false);
        assert.throws(buildArgs);
    });

    for (const invalidValue of ["invalid", "1", " true", "false ", " "]) {
        it(`should reject invalid compatibility configuration ${JSON.stringify(invalidValue)} before constructing secure arguments`, () => {
            stubSecureFlag(true, invalidValue);
            sandbox.stub(tl, "loc").callsFake((key: string) => key);
            assert.throws(() => getMSDeployCmdArgs("package.zip", "site", null,
                false, false, false, null, null, null, false, false, false),
            /WebDeploymentInvalidCompatibilityFlag/);
            assert.strictEqual(featureStub.calledWith(WebDeploymentCompatibilityFixEnabled), false);
        });

        it(`should preserve legacy arguments with security off despite invalid compatibility configuration ${JSON.stringify(invalidValue)}`, () => {
            stubSecureFlag(false, invalidValue);
            assert.strictEqual(getMSDeployCmdArgs("my `package.zip", "site", null,
                false, false, false, null, null, null, false, false, false),
            " -verb:sync -source:package=\"'my `package.zip'\" -dest:contentPath=\"'site'\"   -enableRule:DoNotDeleteRule");
            assert.strictEqual(featureStub.calledWith(WebDeploymentCompatibilityFixEnabled), false);
        });
    }
}

export function runGetSpaceSafeToolPathTests(): void {
    it("should return the path unchanged when it contains no spaces", () => {
        const noSpacePath = "C:\\Tools\\msdeploy.exe";
        assert.strictEqual(getSpaceSafeToolPath(noSpacePath), noSpacePath);
    });

    it("should resolve a space-free short path for a real spaced directory (falls back to the original path if 8.3 names are unavailable)", () => {
        const spacedDir = fs.mkdtempSync(path.join(os.tmpdir(), "space safe test "));
        const spacedFile = path.join(spacedDir, "my tool.exe");
        fs.writeFileSync(spacedFile, "");

        try {
            const result = getSpaceSafeToolPath(spacedFile);
            assert.ok(fs.existsSync(result), "the resolved path must still point at a real, existing file");
            if (result.indexOf(" ") !== -1) {
                assert.strictEqual(result, spacedFile);
            }
        } finally {
            tl.rmRF(spacedDir);
        }
    });
}