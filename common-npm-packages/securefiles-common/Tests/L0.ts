import { tlClone } from "./utils";
import { strictEqual } from "assert";
import { Writable, Readable } from "stream";
import { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";
import {
    deregisterMock,
    resetCache,
    registerMock,
    deregisterAll,
    disable,
    enable
} from "mockery";

export const secureFileId = Math.random().toString(36).slice(2, 7);
process.env['SECUREFILE_NAME_' + secureFileId] = 'securefilename';

const tmAnswers = {
    'exist': {
        'System.TeamFoundationCollectionUri': 'System.TeamFoundationCollectionUri',
    },
    'rmRF': {
        'securefilename': undefined
    }
}

function createMockStream(options: {
    statusCode?: number;
    statusMessage?: string;
    contentType?: string;
    data?: string;
    emitError?: Error;
} = {}) {
    const {
        statusCode = 200,
        statusMessage = 'OK',
        contentType = 'application/octet-stream',
        data = 'data',
        emitError,
    } = options;

    const rs = new Readable();
    rs._read = () => {};
    (rs as any).statusCode = statusCode;
    (rs as any).statusMessage = statusMessage;
    (rs as any).headers = { 'content-type': contentType };
    
    if (emitError) {
        setTimeout(() => {
            rs.emit('error', emitError);
        }, 10);
    } else {
        if (data) rs.push(data);
        rs.push(null);
    }
    
    return rs;
}

// Helper function to create a complete node API mock
function createNodeApiMock(streamOptions?: Parameters<typeof createMockStream>[0]) {
    class MockAgentAPI {
        downloadSecureFile() {
            return Promise.resolve(createMockStream(streamOptions));
        }
    }

    class MockWebApi {
        getTaskAgentApi() {
            return Promise.resolve(new MockAgentAPI());
        }
    }

    return {
        WebApi: MockWebApi,
        getPersonalAccessTokenHandler() {
            return {} as IRequestHandler;
        }
    };
}

export const fsMock = {
    createWriteStream() {
        const ws = new Writable();
        ws._write = function (chunk, encoding, done) {
            done();
        };

        return ws;
    }
};

const getMaxRetries = (maxRetries?: number) => maxRetries >= 0 ? maxRetries : 5;

describe("securefiles-common package suites", function() {
    before(() => {
        enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    after(() => {
        deregisterAll();
        disable();
    });

    beforeEach(() => {
        resetCache();
        registerMock("azure-pipelines-task-lib/task", tlClone);
        tlClone.setAnswers(tmAnswers);
    });

    afterEach(() => {
        deregisterMock("azure-pipelines-task-lib/task");
        deregisterMock("fs");
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

            strictEqual(secureFileHelpers.serverConnection.options.maxRetries, getMaxRetries(maxRetries), `Result should be equal ${maxRetries}`);
            strictEqual(secureFileHelpers.serverConnection.options.socketTimeout, socketTimeout, `Result should be equal ${socketTimeout}`);
        });
    });

    it("Check downloadSecureFile", async() => {
        const nodeapiMock = createNodeApiMock({
            statusCode: 200,
            statusMessage: 'OK',
            contentType: 'application/octet-stream'
        });
        
        registerMock("azure-devops-node-api", nodeapiMock);
        registerMock("fs", fsMock);
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const secureFilePath = await secureFileHelpers.downloadSecureFile(secureFileId);
        const pseudoResolvedPath = await secureFileHelpers.getSecureFileTempDownloadPath(secureFileId);
        strictEqual(secureFilePath, pseudoResolvedPath, `Result should be equal to ${pseudoResolvedPath}`);
    });

    it("Check deleteSecureFile", async() => {
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        secureFileHelpers.deleteSecureFile(secureFileId);
    });

    it("Check getSecureFileTempDownloadPath", async() => {
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const resolvedPath = secureFileHelpers.getSecureFileTempDownloadPath(secureFileId);
        const pseudoResolvedPath = tlClone.resolve(tlClone.getVariable("Agent.TempDirectory"), tlClone.getSecureFileName(secureFileId));
        strictEqual(resolvedPath, pseudoResolvedPath, `Resolved path "${resolvedPath}" should be equal to "${pseudoResolvedPath}"`);
    });

    it("Should handle HTTP error responses", async() => {
        const errorNodeapiMock = createNodeApiMock({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
            contentType: 'application/json',
            data: '',
        });

        registerMock("azure-devops-node-api", errorNodeapiMock);
        registerMock("fs", fsMock);
        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        
        try {
            await secureFileHelpers.downloadSecureFile(secureFileId);
            throw new Error("Expected error was not thrown");
        } catch (error) {
            strictEqual(error.message.includes("HTTP 500"), true, "Should contain HTTP error status");
            strictEqual(error.message.includes("Internal Server Error"), true, "Should contain HTTP error message");
        }
    });

    it("Should handle stream errors during download", async() => {
        const streamErrorNodeapiMock = createNodeApiMock({
            statusCode: 200,
            statusMessage: 'OK',
            contentType: 'application/octet-stream',
            emitError: new Error('Network connection lost')
        });

        registerMock("azure-devops-node-api", streamErrorNodeapiMock);
        registerMock("fs", fsMock);

        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        
        try {
            await secureFileHelpers.downloadSecureFile(secureFileId);
            throw new Error("Expected error was not thrown");
        } catch (error) {
            strictEqual(error.message.includes("Failed to download secure file"), true, "Should handle stream errors");
            strictEqual(error.message.includes("Network connection lost"), true, "Should include original error message");
        }
    });
});
