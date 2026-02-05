import { strictEqual } from "assert";
import { Writable, Readable } from "stream";
import * as sinon from "sinon";
import * as tl from "azure-pipelines-task-lib/task";
import * as nodeApi from "azure-devops-node-api";
import * as fs from "fs";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";

export const secureFileId = Math.random().toString(36).slice(2, 7);
process.env['SECUREFILE_NAME_' + secureFileId] = 'securefilename';

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

function createMockWriteStream() {
    const ws = new Writable();
    ws._write = function (chunk, encoding, done) {
        done();
    };
    return ws;
}

const getMaxRetries = (maxRetries?: number) => maxRetries >= 0 ? maxRetries : 5;

describe("securefiles-common package suites", function() {
    let sandbox: sinon.SinonSandbox;
    let getVariableStub: sinon.SinonStub;
    let getEndpointAuthorizationParameterStub: sinon.SinonStub;
    let getSecureFileNameStub: sinon.SinonStub;
    let getSecureFileTicketStub: sinon.SinonStub;
    let resolveStub: sinon.SinonStub;
    let existStub: sinon.SinonStub;
    let rmRFStub: sinon.SinonStub;
    let debugStub: sinon.SinonStub;
    let getHttpProxyConfigurationStub: sinon.SinonStub;
    let getPersonalAccessTokenHandlerStub: sinon.SinonStub;
    let webApiStub: sinon.SinonStub;
    let createWriteStreamStub: sinon.SinonStub;

    before(() => {
        sandbox = sinon.createSandbox();
    });

    after(() => {
        sandbox.restore();
    });

    beforeEach(() => {
        // Stub task lib functions
        getVariableStub = sandbox.stub(tl, "getVariable").callsFake((variable: string) => {
            if (variable.toLowerCase() === 'system.teamfoundationcollectionuri') {
                return 'https://localhost/';
            }
            return variable;
        });
        getEndpointAuthorizationParameterStub = sandbox.stub(tl, "getEndpointAuthorizationParameter")
            .callsFake((id: string, key: string, optional: boolean) => `${id}_${key}_${optional}`);
        getSecureFileNameStub = sandbox.stub(tl, "getSecureFileName")
            .callsFake((secureFileId: string) => secureFileId);
        getSecureFileTicketStub = sandbox.stub(tl, "getSecureFileTicket").returns("ticket");
        resolveStub = sandbox.stub(tl, "resolve").callsFake((...args: string[]) => args.join('/'));
        existStub = sandbox.stub(tl, "exist").returns(true);
        rmRFStub = sandbox.stub(tl, "rmRF");
        debugStub = sandbox.stub(tl, "debug");
        getHttpProxyConfigurationStub = sandbox.stub(tl, "getHttpProxyConfiguration").returns(null);

        // Stub azure-devops-node-api
        getPersonalAccessTokenHandlerStub = sandbox.stub(nodeApi, "getPersonalAccessTokenHandler").returns({} as any);
    });

    afterEach(() => {
        sandbox.restore();
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
            // Stub WebApi constructor
            const mockWebApi = {
                options: {
                    maxRetries: getMaxRetries(maxRetries),
                    socketTimeout: socketTimeout
                }
            };
            webApiStub = sandbox.stub(nodeApi, "WebApi").returns(mockWebApi as any);

            const secureFiles = require("../securefiles-common");
            const secureFileHelpers = new secureFiles.SecureFileHelpers(...args);

            strictEqual(secureFileHelpers.serverConnection.options.maxRetries, getMaxRetries(maxRetries), `Result should be equal ${maxRetries}`);
            strictEqual(secureFileHelpers.serverConnection.options.socketTimeout, socketTimeout, `Result should be equal ${socketTimeout}`);
        });
    });

    it("Check downloadSecureFile", async() => {
        const mockStream = createMockStream({
            statusCode: 200,
            statusMessage: 'OK',
            contentType: 'application/octet-stream'
        });

        const mockAgentApi = {
            downloadSecureFile: sandbox.stub().resolves(mockStream)
        };

        const mockWebApi = {
            getTaskAgentApi: sandbox.stub().resolves(mockAgentApi),
            options: { maxRetries: 5, socketTimeout: undefined }
        };
        webApiStub = sandbox.stub(nodeApi, "WebApi").returns(mockWebApi as any);
        createWriteStreamStub = sandbox.stub(fs, "createWriteStream").returns(createMockWriteStream() as any);

        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const secureFilePath = await secureFileHelpers.downloadSecureFile(secureFileId);
        const pseudoResolvedPath = secureFileHelpers.getSecureFileTempDownloadPath(secureFileId);
        strictEqual(secureFilePath, pseudoResolvedPath, `Result should be equal to ${pseudoResolvedPath}`);
    });

    it("Check deleteSecureFile", async() => {
        const mockWebApi = {
            options: { maxRetries: 5, socketTimeout: undefined }
        };
        webApiStub = sandbox.stub(nodeApi, "WebApi").returns(mockWebApi as any);

        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        secureFileHelpers.deleteSecureFile(secureFileId);

        sinon.assert.called(rmRFStub);
    });

    it("Check getSecureFileTempDownloadPath", async() => {
        const mockWebApi = {
            options: { maxRetries: 5, socketTimeout: undefined }
        };
        webApiStub = sandbox.stub(nodeApi, "WebApi").returns(mockWebApi as any);

        const secureFiles = require("../securefiles-common");
        const secureFileHelpers = new secureFiles.SecureFileHelpers();
        const resolvedPath = secureFileHelpers.getSecureFileTempDownloadPath(secureFileId);
        
        sinon.assert.calledWith(resolveStub, sinon.match.any, secureFileId);
        strictEqual(typeof resolvedPath, 'string', 'Resolved path should be a string');
    });

    it("Should handle HTTP error responses", async() => {
        const mockStream = createMockStream({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
            contentType: 'application/json',
            data: '',
        });

        const mockAgentApi = {
            downloadSecureFile: sandbox.stub().resolves(mockStream)
        };

        const mockWebApi = {
            getTaskAgentApi: sandbox.stub().resolves(mockAgentApi),
            options: { maxRetries: 5, socketTimeout: undefined }
        };
        webApiStub = sandbox.stub(nodeApi, "WebApi").returns(mockWebApi as any);
        createWriteStreamStub = sandbox.stub(fs, "createWriteStream").returns(createMockWriteStream() as any);

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
        const mockStream = createMockStream({
            statusCode: 200,
            statusMessage: 'OK',
            contentType: 'application/octet-stream',
            emitError: new Error('Network connection lost')
        });

        const mockAgentApi = {
            downloadSecureFile: sandbox.stub().resolves(mockStream)
        };

        const mockWebApi = {
            getTaskAgentApi: sandbox.stub().resolves(mockAgentApi),
            options: { maxRetries: 5, socketTimeout: undefined }
        };
        webApiStub = sandbox.stub(nodeApi, "WebApi").returns(mockWebApi as any);
        createWriteStreamStub = sandbox.stub(fs, "createWriteStream").returns(createMockWriteStream() as any);

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
