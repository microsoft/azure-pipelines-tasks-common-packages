import tl = require('azure-pipelines-task-lib/task');
import util = require("util");
import fs = require('fs');
import httpClient = require("typed-rest-client/HttpClient");
import httpInterfaces = require("typed-rest-client/Interfaces");
import url = require('url');

let proxyUrl: string = tl.getVariable("agent.proxyurl");
var requestOptions: httpInterfaces.IRequestOptions = proxyUrl ? {
    proxy: {
        proxyUrl: proxyUrl,
        proxyUsername: tl.getVariable("agent.proxyusername"),
        proxyPassword: tl.getVariable("agent.proxypassword"),
        proxyBypassHosts: tl.getVariable("agent.proxybypasslist") ? JSON.parse(tl.getVariable("agent.proxybypasslist")) : null
    }
} : {
    allowRedirects: false,
    keepAlive: true
};

let ignoreSslErrors: string = tl.getVariable("VSTS_ARM_REST_IGNORE_SSL_ERRORS");
requestOptions.ignoreSslError = ignoreSslErrors && ignoreSslErrors.toLowerCase() == "true";

var azureHttpUserAgent = tl.getVariable("AZURE_HTTP_USER_AGENT");

export class WebRequest {
    public method: string;
    public uri: string;
    // body can be string or ReadableStream
    public body: string | NodeJS.ReadableStream;
    public headers: any;
}

export class WebResponse {
    public statusCode: number;
    public statusMessage: string;
    public headers: any;
    public body: any;
}

export class WebRequestOptions {
    public retriableErrorCodes: string[];
    public retryCount: number;
    public retryIntervalInSeconds: number;
    public retriableStatusCodes: number[];
    public retryRequestTimedout: boolean;
    public requestTimeout?: number;
    public suppressErrorIssue?: boolean;
}

export async function sendRequest(request: WebRequest, options?: WebRequestOptions): Promise<WebResponse> {
    let i = 0;
    let retryCount = options && options.retryCount ? options.retryCount : 5;
    let retryIntervalInSeconds = options && options.retryIntervalInSeconds ? options.retryIntervalInSeconds : 2;
    let retriableErrorCodes = options && options.retriableErrorCodes ? options.retriableErrorCodes : ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "ESOCKETTIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "EPIPE", "EA_AGAIN"];
    let retriableStatusCodes = options && options.retriableStatusCodes ? options.retriableStatusCodes : [408, 409, 500, 502, 503, 504];
    let timeToWait: number = retryIntervalInSeconds;

    // reset stream on retry even request's body is readable (possible fix for connection reset on large deployments)
    const rawResetStreamOnRetry = tl.getVariable("CLIENT_RESETSTREAMONRETRY");
    let resetStreamOnRetry: boolean = false;
    if (rawResetStreamOnRetry) {
        try {
            tl.debug(`WEBCLIENT - CLIENT_RESETSTREAMONRETRY override is found: ${rawResetStreamOnRetry}`);
            const parsedResetStreamOnRetry = JSON.parse(rawResetStreamOnRetry);
            if (typeof parsedResetStreamOnRetry !== "boolean") {
                throw new Error("Value is not a boolean");
            }
            resetStreamOnRetry = parsedResetStreamOnRetry;
        } catch (error) {
            // this is not a blocker error, so we're informing
            tl.debug(`WEBCLIENT - CLIENT_RESETSTREAMONRETRY override is found couldn't be parsed due to error ${error}. resetStreamOnRetry=${resetStreamOnRetry} is used instead`);
        }
    }

    while (true) {
        try {
            if (request.body && typeof (request.body) !== 'string' && (resetStreamOnRetry || !request.body["readable"])) {
                tl.debug(`WEBCLIENT - request body stream is reset due to the reason : ${resetStreamOnRetry ? 'resetStreamOnRetry is set.' : 'request body is not readable.'}`);
                request.body = fs.createReadStream(request.body["path"]);
            }

            let response: WebResponse = await sendRequestInternal(request, options);
            if (retriableStatusCodes.indexOf(response.statusCode) != -1 && ++i < retryCount) {
                tl.debug(util.format("Encountered a retriable status code: %s. Message: '%s'.", response.statusCode, response.statusMessage));
                await sleepFor(timeToWait);
                timeToWait = timeToWait * retryIntervalInSeconds + retryIntervalInSeconds;
                continue;
            }

            return response;
        }
        catch (error) {
            if (retriableErrorCodes.indexOf(error.code) != -1 && ++i < retryCount) {
                tl.debug(util.format("Encountered a retriable error:%s. Message: %s.", error.code, error.message));
                await sleepFor(timeToWait);
                timeToWait = timeToWait * retryIntervalInSeconds + retryIntervalInSeconds;
            }
            else {
                if (error.code && !(options && options.suppressErrorIssue)) {
                    console.log("##vso[task.logissue type=error;code=" + error.code + ";]");
                }

                throw error;
            }
        }
    }
}

export function sleepFor(sleepDurationInSeconds): Promise<any> {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, sleepDurationInSeconds * 1000);
    });
}

async function sendRequestInternal(request: WebRequest, options?: WebRequestOptions): Promise<WebResponse> {
    tl.debug(util.format("[%s]%s", request.method, request.uri));
    const currentRequestOptions: httpInterfaces.IRequestOptions = {
        ...requestOptions
    };

    if (options && options.requestTimeout !== undefined) {
        currentRequestOptions.socketTimeout = options.requestTimeout;
    }

    const httpCallbackClient = new httpClient.HttpClient(azureHttpUserAgent, null, currentRequestOptions);
    let timeoutHandle: NodeJS.Timeout;
    const disposeRequestResources = prepareRequestResources(httpCallbackClient, request, options && options.requestTimeout);

    try {
        const responsePromise = httpCallbackClient.request(request.method, request.uri, request.body, request.headers)
            .then(response => toWebResponse(response));

        if (options && options.requestTimeout !== undefined) {
            const timeoutPromise = new Promise<WebResponse>((resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    const timeoutError: any = new Error(`Request timed out after ${options.requestTimeout} ms: ${request.uri}`);
                    timeoutError.code = 'ETIMEDOUT';
                    disposeRequestResources();
                    reject(timeoutError);
                }, options.requestTimeout);
            });

            return await Promise.race([responsePromise, timeoutPromise]);
        }

        return await responsePromise;
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        disposeRequestResources();
        httpCallbackClient.dispose();
    }
}

function prepareRequestResources(client: httpClient.HttpClient, request: WebRequest, requestTimeout?: number): () => void {
    if (requestTimeout === undefined) {
        return () => { };
    }

    const internalClient: any = client;
    if (typeof internalClient._getAgent !== 'function') {
        return () => { };
    }

    internalClient._keepAlive = true;
    const agent: any = internalClient._getAgent(new url.URL(request.uri));
    const pendingProxyRequests: any[] = [];
    const isTunnelingAgent = agent && Array.isArray(agent.requests) && Array.isArray(agent.sockets) && agent.proxyOptions;

    if (isTunnelingAgent && agent.request) {
        const createProxyRequest = agent.request;
        agent.request = (requestOptions) => {
            const proxyRequest = createProxyRequest(requestOptions);
            pendingProxyRequests.push(proxyRequest);
            proxyRequest.once('close', () => {
                const requestIndex = pendingProxyRequests.indexOf(proxyRequest);
                if (requestIndex !== -1) {
                    pendingProxyRequests.splice(requestIndex, 1);
                }
            });
            return proxyRequest;
        };
    }

    return () => {
        pendingProxyRequests.splice(0).forEach(proxyRequest => proxyRequest.destroy());
        if (isTunnelingAgent) {
            agent.requests.splice(0).forEach(pendingRequest => pendingRequest.request.destroy());
            agent.sockets.splice(0).forEach(socket => {
                if (socket && socket.destroy) {
                    socket.destroy();
                }
            });
        } else if (agent && typeof agent.destroy === 'function') {
            agent.destroy();
        }
    };
}

async function toWebResponse(response: httpClient.HttpClientResponse): Promise<WebResponse> {
    var res = new WebResponse();
    if (response) {
        res.statusCode = response.message.statusCode;
        res.statusMessage = response.message.statusMessage;
        res.headers = response.message.headers;
        var body = await response.readBody();
        if (body) {
            try {
                res.body = JSON.parse(body);
            }
            catch (error) {
                tl.debug("Could not parse response: " + JSON.stringify(error));
                tl.debug("Response: " + JSON.stringify(res.body));
                res.body = body;
            }
        }
    }

    return res;
}
