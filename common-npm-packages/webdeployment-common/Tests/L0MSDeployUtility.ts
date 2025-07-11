import assert = require("assert");
import sinon = require("sinon");
import * as tl from "azure-pipelines-task-lib/task"; // Adjust the import path as needed
import { getMSDeployCmdArgs, getWebDeployErrorCode } from "../msdeployutility";

export function runGetMSDeployCmdArgsTests() {
    let getPipelineFeatureStub: sinon.SinonStub;

    before(() => {
        getPipelineFeatureStub = sinon.stub(tl, "getPipelineFeature");
        getPipelineFeatureStub.withArgs("CommaSeperatedConnectionString").returns(true); // or whatever value you want to mock
    });

    after(() => {
        getPipelineFeatureStub.restore();
    });
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
    it('Should CSstring encode correctly', () => {
        const profile = createDefaultPublishProfile();
        tl.getPipelineFeature("CommaSeperatedConnectionString");
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '"-retryAttempts:11 -retryInterval:5000 -setParam:name=\'ConnectionString\',value=\'Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\'', false, false, true);
        checkParametersIfPresent(args, ['-retryAttempts:11', '-retryInterval:5000', '-setParam:name="\"ConnectionString\"",value="\"Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\""']);
        const CSstring = '-setParam:name="\\"ConnectionString\\"",value="\\"Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\\""';
        assert.ok(args.includes(CSstring));
    });
    it('Should CSstring encode in-correctly', () => {
        getPipelineFeatureStub.withArgs("CommaSeperatedConnectionString").returns(false);
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '"-retryAttempts:11 -retryInterval:5000 -setParam:name=\'ConnectionString\',value=\'Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\'', false, false, true);
        const CSstring = '-setParam:name="ConnectionString",value="Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;"';
        assert.ok(!args.includes(CSstring));
        checkParametersIfPresent(args, ['-retryAttempts:11', '-retryInterval:5000', '-setParam:name="\"ConnectionString\"",value="\"Encrypt=True;TrustServerCertificate=False;Data Source=some-sql-server.database.windows.net,1433;Initial Catalog=some-database;User Id=someuser;Password=somepassword;\""']);
    });
    it('Should encrypt skip directives correctly', () => {
        getPipelineFeatureStub.withArgs("CommaSeperatedConnectionString").returns(true);
        const profile = createDefaultPublishProfile();
        const args = getMSDeployCmdArgs('package.zip', 'webapp_name', profile, false, true, true, null, null, '-skip:objectName=filePath,absolutePath="\\web\.config"', false, false, true);
        const skipsubstring = '-skip:objectName=filePath,absolutePath="\\"\\web.config\\""';
        checkParametersIfPresent(args, ['-skip:objectName=filePath,absolutePath="\\"\\web.config\\""']);
        assert.ok(args.includes(skipsubstring));
    });
    it('Should encrypt skip directives in-correctly', () => {
        getPipelineFeatureStub.withArgs("CommaSeperatedConnectionString").returns(true);
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