import { runGetMSDeployCmdArgsTests, runGetWebDeployErrorCodeTests } from './L0MSDeployUtility';
import { runCopyDirectoryTests } from "./L0CopyDirectory";
import { runGenerateWebCongigTests } from "./L0GenerateWebConfig";

describe('MSDeploy tests', () => {
    describe('GetMSDeployCmdArgs tests', runGetMSDeployCmdArgsTests);
    describe('GetWebDeployErrorCode tests', runGetWebDeployErrorCodeTests);

    describe("CopyDirectory tests", runCopyDirectoryTests);

    describe("GenerateWebConfig tests", runGenerateWebCongigTests);
});