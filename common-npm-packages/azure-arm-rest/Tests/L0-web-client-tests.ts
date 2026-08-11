import assert = require('assert');
import http = require('http');
import httpClient = require('typed-rest-client/HttpClient');
import * as tl from 'azure-pipelines-task-lib/task';

import { validateAzModuleVersion } from '../azCliUtility';
import * as webClient from '../webClient';

export function WebClientTests() {
    const originalHttpClient = httpClient.HttpClient;
    const originalSendRequest = webClient.sendRequest;
    const originalGetPipelineFeature = tl.getPipelineFeature;
    const originalDebug = tl.debug;
    const originalWarning = tl.warning;
    const originalConsoleLog = console.log;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalNoProxy = process.env.NO_PROXY;

    afterEach(() => {
        (httpClient as any).HttpClient = originalHttpClient;
        (webClient as any).sendRequest = originalSendRequest;
        (tl as any).getPipelineFeature = originalGetPipelineFeature;
        (tl as any).debug = originalDebug;
        (tl as any).warning = originalWarning;
        console.log = originalConsoleLog;
        restoreEnvironmentVariable('HTTPS_PROXY', originalHttpsProxy);
        restoreEnvironmentVariable('NO_PROXY', originalNoProxy);
    });

    it('applies the request timeout and disposes the client on success', async () => {
        let capturedOptions: any;
        let disposeCount = 0;

        (httpClient as any).HttpClient = class {
            constructor(userAgent: string, handlers: any[], options: any) {
                capturedOptions = options;
            }

            public async request() {
                return {
                    message: {
                        statusCode: 200,
                        statusMessage: 'OK',
                        headers: {}
                    },
                    readBody: async () => '{}'
                };
            }

            public dispose() {
                disposeCount++;
            }
        };

        const request = Object.assign(new webClient.WebRequest(), {
            method: 'GET',
            uri: 'https://example.test',
            headers: {}
        });
        const options = Object.assign(new webClient.WebRequestOptions(), { requestTimeout: 3000 });

        const response = await webClient.sendRequest(request, options);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(capturedOptions.socketTimeout, 3000);
        assert.strictEqual(disposeCount, 1);
    });

    it('makes one attempt, suppresses the task issue, and disposes on failure', async () => {
        let requestCount = 0;
        let disposeCount = 0;
        const consoleOutput: string[] = [];

        (httpClient as any).HttpClient = class {
            public async request() {
                requestCount++;
                const error: any = new Error('connection reset');
                error.code = 'ECONNRESET';
                throw error;
            }

            public dispose() {
                disposeCount++;
            }
        };
        console.log = (message?: any) => consoleOutput.push(String(message));

        const request = Object.assign(new webClient.WebRequest(), {
            method: 'GET',
            uri: 'https://example.test',
            headers: {}
        });
        const options = Object.assign(new webClient.WebRequestOptions(), {
            retryCount: 1,
            suppressErrorIssue: true
        });

        await assert.rejects(webClient.sendRequest(request, options), /connection reset/);

        assert.strictEqual(requestCount, 1);
        assert.strictEqual(disposeCount, 1);
        assert.strictEqual(consoleOutput.some(line => line.includes('task.logissue')), false);
    });

    it('preserves default timeout and error issue behavior when options are omitted', async () => {
        let capturedOptions: any;
        const consoleOutput: string[] = [];

        (httpClient as any).HttpClient = class {
            constructor(userAgent: string, handlers: any[], options: any) {
                capturedOptions = options;
            }

            public async request() {
                const error: any = new Error('request failed');
                error.code = 'CUSTOM';
                throw error;
            }

            public dispose() {
            }
        };
        console.log = (message?: any) => consoleOutput.push(String(message));

        const request = Object.assign(new webClient.WebRequest(), {
            method: 'GET',
            uri: 'https://example.test',
            headers: {}
        });

        await assert.rejects(webClient.sendRequest(request), /request failed/);

        assert.strictEqual(capturedOptions.socketTimeout, undefined);
        assert.strictEqual(consoleOutput.some(line => line.includes('##vso[task.logissue type=error;code=CUSTOM;]request failed')), true);
    });

    it('preserves behavior for callers using only the existing request options', async () => {
        let capturedOptions: any;
        let requestCount = 0;

        (httpClient as any).HttpClient = class {
            constructor(userAgent: string, handlers: any[], options: any) {
                capturedOptions = options;
            }

            public async request() {
                requestCount++;
                return {
                    message: {
                        statusCode: 200,
                        statusMessage: 'OK',
                        headers: {}
                    },
                    readBody: async () => '{}'
                };
            }

            public dispose() {
            }
        };

        const request = Object.assign(new webClient.WebRequest(), {
            method: 'GET',
            uri: 'https://example.test',
            headers: {}
        });
        const options: webClient.WebRequestOptions = {
            retriableErrorCodes: [],
            retryCount: 1,
            retryIntervalInSeconds: 5,
            retriableStatusCodes: [],
            retryRequestTimedout: true
        };

        const response = await webClient.sendRequest(request, options);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(requestCount, 1);
        assert.strictEqual(capturedOptions.socketTimeout, undefined);
    });

    it('terminates a request when the socket does not respond', async () => {
        const server = http.createServer(() => {
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

        try {
            const address = server.address() as { port: number };
            const request = Object.assign(new webClient.WebRequest(), {
                method: 'GET',
                uri: `http://127.0.0.1:${address.port}`,
                headers: {}
            });
            const options = Object.assign(new webClient.WebRequestOptions(), {
                retryCount: 1,
                requestTimeout: 50,
                suppressErrorIssue: true
            });
            const startedAt = Date.now();

            await assert.rejects(webClient.sendRequest(request, options));

            assert(Date.now() - startedAt < 2000, 'the socket timeout should bound the stalled request');
        } finally {
            server.close();
        }
    });

    it('terminates a proxy CONNECT request when the proxy does not respond', async () => {
        const proxyServer = http.createServer();
        proxyServer.on('connect', () => {
        });
        await new Promise<void>(resolve => proxyServer.listen(0, '127.0.0.1', resolve));

        try {
            const address = proxyServer.address() as { port: number };
            process.env.HTTPS_PROXY = `http://127.0.0.1:${address.port}`;
            process.env.NO_PROXY = '';
            const request = Object.assign(new webClient.WebRequest(), {
                method: 'GET',
                uri: 'https://example.test',
                headers: {}
            });
            const options = Object.assign(new webClient.WebRequestOptions(), {
                retryCount: 1,
                requestTimeout: 50,
                suppressErrorIssue: true
            });
            const startedAt = Date.now();

            await assert.rejects(webClient.sendRequest(request, options), (error: any) => error.code === 'ETIMEDOUT');

            assert(Date.now() - startedAt < 2000, 'the socket timeout should bound the stalled proxy CONNECT request');
        } finally {
            proxyServer.close();
        }
    });

    it('uses bounded request options for the advisory version check', async () => {
        let requestCount = 0;
        let capturedRequest: webClient.WebRequest;
        let capturedOptions: webClient.WebRequestOptions;
        let warningCount = 0;

        (tl as any).getPipelineFeature = () => true;
        (tl as any).warning = () => warningCount++;
        (webClient as any).sendRequest = async (request: webClient.WebRequest, options: webClient.WebRequestOptions) => {
            requestCount++;
            capturedRequest = request;
            capturedOptions = options;
            return { body: [{ tag_name: 'azure-cli-2.90.0' }] };
        };

        await validateAzModuleVersion('azure-Cli', '2.80.0', 'Azure-Cli', 1);

        assert.strictEqual(requestCount, 1);
        assert.strictEqual(capturedRequest.uri, 'https://api.github.com/repos/Azure/azure-Cli/releases');
        assert.strictEqual(capturedOptions.retryCount, 1);
        assert.strictEqual(capturedOptions.requestTimeout, 3000);
        assert.strictEqual(capturedOptions.suppressErrorIssue, true);
        assert.strictEqual(warningCount, 1);
    });

    it('logs advisory request failures at debug level and continues', async () => {
        const debugOutput: string[] = [];

        (tl as any).getPipelineFeature = () => true;
        (tl as any).debug = (message: string) => debugOutput.push(message);
        (webClient as any).sendRequest = async () => {
            throw new Error('GitHub unavailable');
        };

        await validateAzModuleVersion('azure-Cli', '2.90.0', 'Azure-Cli', 1);

        assert.strictEqual(debugOutput.some(line => line.includes('GitHub unavailable') && line.includes('skipping the check')), true);
    });

    it('does not make an advisory request when the feature is disabled', async () => {
        let requestCount = 0;

        (tl as any).getPipelineFeature = () => false;
        (webClient as any).sendRequest = async () => {
            requestCount++;
            return { body: [] };
        };

        await validateAzModuleVersion('azure-Cli', '2.90.0', 'Azure-Cli', 1);

        assert.strictEqual(requestCount, 0);
    });
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
