import { runGetMSDeployCmdArgsTests, runGetWebDeployErrorCodeTests } from './L0MSDeployUtility';
import { runCopyDirectoryTests } from "./L0CopyDirectory";
import { runGenerateWebCongigTests } from "./L0GenerateWebConfig";
import { runL1XmlVarSubTests } from "./L1XmlVarSub";

describe('MSDeploy tests', () => {
    describe('GetMSDeployCmdArgs tests', runGetMSDeployCmdArgsTests);
    describe('GetWebDeployErrorCode tests', runGetWebDeployErrorCodeTests);

    describe("CopyDirectory tests", runCopyDirectoryTests);

    describe("GenerateWebConfig tests", runGenerateWebCongigTests);

    describe("L1XmlVarSub tests", runL1XmlVarSubTests);
});