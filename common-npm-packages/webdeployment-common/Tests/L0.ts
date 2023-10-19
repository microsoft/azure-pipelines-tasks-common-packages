import { runGetMSDeployCmdArgsTests, runGetWebDeployErrorCodeTests } from './L0MSDeployUtility';
import { runCopyDirectoryTests } from "./L0CopyDirectory";
import { runGenerateWebCongigTests } from "./L0GenerateWebConfig";
import { runL1XmlVarSubTests } from "./L1XmlVarSub";
import { runL1XdtTransformTests } from "./L1XdtTransform"
import { runL1JSONVarSubWithCommentsTests } from "./L1JSONVarSubWithComments";

describe('MSDeploy tests', () => {
    describe('GetMSDeployCmdArgs tests', runGetMSDeployCmdArgsTests);
    describe('GetWebDeployErrorCode tests', runGetWebDeployErrorCodeTests);
    describe("CopyDirectory tests", runCopyDirectoryTests);
    describe("GenerateWebConfig tests", runGenerateWebCongigTests);
    describe("L1XmlVarSub tests", runL1XmlVarSubTests);
    describe("L1XdtTransform tests", runL1XdtTransformTests);
    describe("L1JSONVarSubWithComments tests", runL1JSONVarSubWithCommentsTests);
});