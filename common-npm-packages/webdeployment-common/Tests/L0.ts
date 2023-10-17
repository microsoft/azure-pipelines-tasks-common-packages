import { runGetMSDeployCmdArgsTests, runGetWebDeployErrorCodeTests } from './L0MSDeployUtility';

describe('MSDeploy tests', () => {
    describe('GetMSDeployCmdArgs tests', runGetMSDeployCmdArgsTests);
    describe('GetWebDeployErrorCode tests', runGetWebDeployErrorCodeTests);
});