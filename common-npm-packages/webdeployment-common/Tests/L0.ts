import { runGetMSDeployCmdArgsTests, runGetWebDeployErrorCodeTests } from './L0MSDeployUtility';
import { runCopyDirectoryTests } from "./L0CopyDirectory";

describe('MSDeploy tests', () => {
    describe('GetMSDeployCmdArgs tests', runGetMSDeployCmdArgsTests);
    describe('GetWebDeployErrorCode tests', runGetWebDeployErrorCodeTests);

    describe("CopyDirectory tests", runCopyDirectoryTests);
});