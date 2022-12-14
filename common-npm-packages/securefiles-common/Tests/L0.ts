import * as assert from "assert";
import * as mockery from "mockery";
import { Writable, Readable } from "stream";
import { resolve } from "path";
import { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";

export const tlMock = {
    getVariable(name: string) {
        return `${name}_value`;
    },
    getEndpointAuthorizationParameter(id: string, key: string, optional: boolean) {
        return `${id}_${key}_${optional}`;
    },
    debug() {
        return;
    },
    getHttpProxyConfiguration() {
        return false;
    },
    getSecureFileName(secureFileId: string) {
        return `${secureFileId}_secureFileId`;
    },
    resolve(...pathSegments) {
        return resolve(...pathSegments as string[]);
    },
    exist(path: string) {
        return true;
    },
    rmRF(path: string) {
        return;
    },
    getSecureFileTicket() {
        return {};
    }
};

class AgentAPI {
    downloadSecureFile() {
        const rs = new Readable();
        rs._read = () => {};
        rs.push('data');
        rs.push(null);
        return rs;
    }
}

class WebApi {
    getTaskAgentApi() {
        return new Promise((resolve) => {
            resolve(new AgentAPI());
        });
    }
}

export const nodeapiMock = {
    WebApi,
    getPersonalAccessTokenHandler() {
        return {} as IRequestHandler;
    }
}

export const fsMock = {
    createWriteStream() {
        const ws = new Writable();
        ws._write = function (chunk, encoding, done) {
            done();
        };

        return ws;
    },
    existsSync() {
        return true;
    },
    readFileSync() {
        return "";
    }
};

const getMaxRetries = (maxRetries?: number) => maxRetries >= 0 ? maxRetries : 5;

describe("securefiles-common package suites", function() {
    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    after(() => {
        mockery.deregisterAll();
        mockery.disable();
    });

    beforeEach(() => {
        mockery.resetCache();
        mockery.registerMock("azure-pipelines-task-lib/task", tlMock);
    });

    afterEach(() => {
        mockery.deregisterMock("azure-pipelines-task-lib/task");
        mockery.deregisterMock("fs");
    });

    const secureFilesHelpersProps = [
        [ 10, 1000],
        [ undefined, undefined ],
        [ undefined, 30 ],
        [ 3, undefined ]
    ];

    secureFilesHelpersProps.forEach((args) => {
        const [ maxRetries, socketTimeout ] = args;

        it(`Check SecureFileHelpers instance properties with args: [${maxRetries}, ${socketTimeout}]`, async() => {
            const secureFiles = require("../securefiles-common");

            const secureFileHelpers = new secureFiles.SecureFileHelpers(...args);

            assert.strictEqual(secureFileHelpers.serverConnection.options.maxRetries, getMaxRetries(maxRetries), `Result should be equal ${maxRetries}`);
            assert.strictEqual(secureFileHelpers.serverConnection.options.socketTimeout, socketTimeout, `Result should be equal ${socketTimeout}`);
        });
    });

    it("Check downloadSecureFile", async() => {
        mockery.registerMock("azure-devops-node-api", nodeapiMock);
        mockery.registerMock("fs", fsMock);
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const secureFileId = Math.random().toString(36).slice(2, 7);
        const secureFilePath = await secureFileHelpers.downloadSecureFile(secureFileId);
        const pseudoResolvedPath = await secureFileHelpers.getSecureFileTempDownloadPath(secureFileId);
        assert.strictEqual(secureFilePath, pseudoResolvedPath, `Result should be equal to ${pseudoResolvedPath}`);
    });

    it("Check deleteSecureFile", async() => {
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const secureFileId = Math.random().toString(36).slice(2, 7);
        secureFileHelpers.deleteSecureFile(secureFileId);
    });

    it("Check getSecureFileTempDownloadPath", async() => {
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const secureFileId = Math.random().toString(36).slice(2, 7);
        const resolvedPath = secureFileHelpers.getSecureFileTempDownloadPath(secureFileId);
        const pseudoResolvedPath = tlMock.resolve(tlMock.getVariable("Agent.TempDirectory"), tlMock.getSecureFileName(secureFileId));
        assert.strictEqual(resolvedPath, pseudoResolvedPath, `Resolved path "${resolvedPath}" should be equal to "${pseudoResolvedPath}"`);
    });
});
