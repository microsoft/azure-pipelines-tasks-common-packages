import crypto = require('crypto');
import fs = require('fs');
import path = require('path');

import tl = require('azure-pipelines-task-lib/task');

import { WebJob, SiteExtension } from './azureModels';
import { KUDU_DEPLOYMENT_CONSTANTS } from './constants';
import webClient = require('./webClient');

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class KuduServiceManagementClient {
    private _scmUri;
    private _authHeader: string;
    private _cookie: string[] = undefined;

    constructor(scmUri: string, authHeader: string) {
        this._authHeader = authHeader;
        this._scmUri = scmUri;
    }

    public async beginRequest(request: webClient.WebRequest, reqOptions?: webClient.WebRequestOptions, contentType?: string): Promise<webClient.WebResponse> {
        request.headers = request.headers || {};

        request.headers["Authorization"] = this._authHeader;

        if (!request.headers['Content-Type'] || !!contentType) {
            request.headers['Content-Type'] = contentType || 'application/json; charset=utf-8';
        }

        if (!!this._cookie) {
            tl.debug(`setting affinity cookie ${JSON.stringify(this._cookie)}`);
            request.headers['Cookie'] = this._cookie;
        }

        let retryCount = reqOptions && (typeof reqOptions.retryCount === 'number') ? reqOptions.retryCount : 5;
        while(retryCount >= 0) {
            try {
                let httpResponse = await webClient.sendRequest(request, reqOptions);
                if (httpResponse.headers['set-cookie'] && !this._cookie) {
                    this._cookie = httpResponse.headers['set-cookie'];
                    tl.debug(`loaded affinity cookie ${JSON.stringify(this._cookie)}`);
                }

                return httpResponse;
            }
            catch(exception) {
                let exceptionString: string = exception.toString();
                if (exceptionString.indexOf("Hostname/IP doesn't match certificates's altnames") != -1
                    || exceptionString.indexOf("unable to verify the first certificate") != -1
                    || exceptionString.indexOf("unable to get local issuer certificate") != -1) {
                        tl.warning(tl.loc('ASE_SSLIssueRecommendation'));
                }

                if (retryCount > 0 && exceptionString.indexOf('Request timeout') != -1 && (!reqOptions || reqOptions.retryRequestTimedout)) {
                    tl.debug('encountered request timedout issue in Kudu. Retrying again');
                    retryCount -= 1;
                    continue;
                }

                throw new Error(exceptionString);
            }
        }
    }

    public getRequestUri(uriFormat: string, queryParameters?: Array<string>) {
        uriFormat = uriFormat[0] == "/" ? uriFormat : "/" + uriFormat;

        if (queryParameters && queryParameters.length > 0) {
            uriFormat = uriFormat + '?' + queryParameters.join('&');
        }

        return this._scmUri + uriFormat;
    }

    public getScmUri(): string {
        return this._scmUri;
    }
}

export class Kudu {
    public client: KuduServiceManagementClient;

    constructor(scmUri: string, authHeader: string) {
        this.client = new KuduServiceManagementClient(scmUri, authHeader);
    }

    public async updateDeployment(requestBody: any): Promise<string> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.body = JSON.stringify(requestBody);
        httpRequest.uri = this.client.getRequestUri(`/api/deployments/${requestBody.id}`);

        try {
            let webRequestOptions: webClient.WebRequestOptions = {retriableErrorCodes: [], retriableStatusCodes: [], retryCount: 1, retryIntervalInSeconds: 5, retryRequestTimedout: true};
            var response = await this.client.beginRequest(httpRequest, webRequestOptions);
            tl.debug(`updateDeployment. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                console.log(tl.loc("Successfullyupdateddeploymenthistory", response.body.url));
                return response.body.id;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('Failedtoupdatedeploymenthistory', this._getFormattedError(error)));
        }
    }

    public getKuduStackTraceUrl(): string {
        let stackTraceUrl = this.client.getRequestUri(`/api/vfs/LogFiles/kudu/trace`);
        return stackTraceUrl;
    }

    public async getContinuousJobs(): Promise<Array<WebJob>> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/continuouswebjobs`);
        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getContinuousJobs. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return response.body as Array<WebJob>;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetContinuousWebJobs', this._getFormattedError(error)))
        }
    }

    public async startContinuousWebJob(jobName: string): Promise<WebJob> {
        console.log(tl.loc('StartingWebJob', jobName));
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.uri = this.client.getRequestUri(`/api/continuouswebjobs/${jobName}/start`);

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`startContinuousWebJob. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                console.log(tl.loc('StartedWebJob', jobName));
                return response.body as WebJob;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToStartContinuousWebJob', jobName, this._getFormattedError(error)));
        }
    }

    public async stopContinuousWebJob(jobName: string): Promise<WebJob> {
        console.log(tl.loc('StoppingWebJob', jobName));
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.uri = this.client.getRequestUri(`/api/continuouswebjobs/${jobName}/stop`);

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`stopContinuousWebJob. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                console.log(tl.loc('StoppedWebJob', jobName));
                return response.body as WebJob;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToStopContinuousWebJob', jobName, this._getFormattedError(error)));
        }
    }

    public async installSiteExtension(extensionID: string): Promise<SiteExtension> {
        console.log(tl.loc("InstallingSiteExtension", extensionID));
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.uri = this.client.getRequestUri(`/api/siteextensions/${extensionID}`);
        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`installSiteExtension. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                console.log(tl.loc("SiteExtensionInstalled", extensionID));
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToInstallSiteExtension', extensionID, this._getFormattedError(error)))
        }
    }

    public async installSiteExtensionWithVersion(extensionID: string, version: string): Promise<SiteExtension> {
        console.log(tl.loc("InstallingSiteExtensionWithVersion", extensionID, version));
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.uri = this.client.getRequestUri(`/api/siteextensions/${extensionID}`);
        httpRequest.body = JSON.stringify({ version: version });
        httpRequest.headers = {
            'Content-Type': 'application/json'
        };

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`installSiteExtensionWithVersion. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                console.log(tl.loc("SiteExtensionInstalledWithVersion", extensionID, version));
                return response.body;
            }

            throw response;
        }
        catch (error) {
            throw Error(tl.loc('FailedToInstallSiteExtensionWithVersion', extensionID, version, this._getFormattedError(error)));
        }
    }

    public async getSiteExtensions(): Promise<Array<SiteExtension>> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/siteextensions`, ['checkLatest=false']);
        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getSiteExtensions. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return response.body as Array<SiteExtension>;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetSiteExtensions', this._getFormattedError(error)))
        }
    }

    public async getAllSiteExtensions(): Promise<Array<SiteExtension>> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/extensionfeed`);
        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getAllSiteExtensions. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return response.body as Array<SiteExtension>;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetAllSiteExtensions', this._getFormattedError(error)))
        }
    }

    public async getProcess(processID: number): Promise<any> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/processes/${processID}`);
        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getProcess. status code: ${response.statusCode} - ${response.statusMessage}`);
            if (response.statusCode == 200) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetProcess', this._getFormattedError(error)))
        }
    }

    public async killProcess(processID: number): Promise<void> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'DELETE';
        httpRequest.uri = this.client.getRequestUri(`/api/processes/${processID}`);
        var reqOptions: webClient.WebRequestOptions = {
            retriableErrorCodes: ["ETIMEDOUT"],
            retriableStatusCodes: [503],
            retryCount: 1,
            retryIntervalInSeconds: 5,
            retryRequestTimedout: true
        };
        try {
            var response = await this.client.beginRequest(httpRequest, reqOptions);
            tl.debug(`killProcess. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 502) {
                tl.debug(`Killed Process ${processID}`);
                return;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToKillProcess', this._getFormattedError(error)))
        }
    }

    public async getAppSettings(): Promise<Map<string, string>> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/settings`);

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getAppSettings. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToFetchKuduAppSettings', this._getFormattedError(error)));
        }
    }

    public async listDir(physicalPath: string): Promise<any> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/vfs/${physicalPath}/`);
        httpRequest.headers = {
            'If-Match': '*'
        };

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`listFiles. Data: ${JSON.stringify(response)}`);
            if ([200, 201, 204].indexOf(response.statusCode) != -1) {
                return response.body;
            }
            else if (response.statusCode === 404) {
                return null;
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw Error(tl.loc('FailedToListPath', physicalPath, this._getFormattedError(error)));
        }
    }

    public async getFileContent(physicalPath: string, fileName: string): Promise<string> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = this.client.getRequestUri(`/api/vfs/${physicalPath}/${fileName}`);
        httpRequest.headers = {
            'If-Match': '*'
        };

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getFileContent. Status code: ${response.statusCode} - ${response.statusMessage}`);
            if ([200, 201, 204].indexOf(response.statusCode) != -1) {
                return response.body;
            }
            else if (response.statusCode === 404) {
                return null;
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetFileContent', physicalPath, fileName, this._getFormattedError(error)));
        }
    }

    public async uploadFile(physicalPath: string, fileName: string, filePath: string): Promise<void> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        if (!tl.exist(filePath)) {
            throw new Error(tl.loc('FilePathInvalid', filePath));
        }

        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.uri = this.client.getRequestUri(`/api/vfs/${physicalPath}/${fileName}`);
        httpRequest.headers = {
            'If-Match': '*'
        };
        httpRequest.body = fs.createReadStream(filePath);

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`uploadFile. Data: ${JSON.stringify(response)}`);
            if ([200, 201, 204].indexOf(response.statusCode) != -1) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToUploadFile', physicalPath, fileName, this._getFormattedError(error)));
        }
    }

    public async createPath(physicalPath: string): Promise<any> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.uri = this.client.getRequestUri(`/api/vfs/${physicalPath}/`);
        httpRequest.headers = {
            'If-Match': '*'
        };

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`createPath. Data: ${JSON.stringify(response)}`);
            if ([200, 201, 204].indexOf(response.statusCode) != -1) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToCreatePath', physicalPath, this._getFormattedError(error)));
        }
    }

    public async runCommand(physicalPath: string, command: string): Promise<void> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.uri = this.client.getRequestUri(`/api/command`);
        httpRequest.headers = {
            'If-Match': '*'
        };
        httpRequest.body = JSON.stringify({
            'command': command,
            'dir': physicalPath
        });

        try {
            tl.debug('Executing Script on Kudu. Command: ' + command);
            let webRequestOptions: webClient.WebRequestOptions = {retriableErrorCodes: null, retriableStatusCodes: null, retryCount: 5, retryIntervalInSeconds: 5, retryRequestTimedout: false};
            var response = await this.client.beginRequest(httpRequest, webRequestOptions);
            tl.debug(`runCommand. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return ;
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw Error(error.toString());
        }
    }

    public async extractZIP(webPackage: string, physicalPath: string): Promise<void> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.uri = this.client.getRequestUri(`/api/zip/${physicalPath}/`);
        httpRequest.headers = {
            'Content-Type': 'multipart/form-data',
            'If-Match': '*'
        };
        httpRequest.body = fs.createReadStream(webPackage);

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`extractZIP. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return ;
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw Error(tl.loc('Failedtodeploywebapppackageusingkuduservice', this._getFormattedError(error)));
        }
    }

    public async zipDeploy(webPackage: string, queryParameters?: Array<string>, addChecksumHeader?: boolean): Promise<any> {
        let httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.uri = this.client.getRequestUri(`/api/zipdeploy`, queryParameters);

        var rs = fs.createReadStream(webPackage);
        var checksum: string = undefined;

        httpRequest.body = rs;
        httpRequest.headers = {
            'Content-Type': 'application/octet-stream'
        };

        if (addChecksumHeader !== undefined && addChecksumHeader) {
            checksum = await this._computeFileChecksum(rs);
            if (checksum !== undefined){
                httpRequest.headers["x-ms-artifact-checksum"] = checksum;
            }
        }

        try {
            let response = await this.client.beginRequest(httpRequest);
            tl.debug(`ZIP Deploy response: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                tl.debug('Deployment passed');
                return null;
            }
            else if (response.statusCode == 202) {
                let pollableURL: string = response.headers.location;
                if (!!pollableURL) {
                    tl.debug(`Polling for ZIP Deploy URL: ${pollableURL}`);
                    return await this._getDeploymentDetailsFromPollURL(pollableURL);
                }
                else {
                    tl.debug('zip deploy returned 202 without pollable URL.');
                    return null;
                }
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw new Error(tl.loc('PackageDeploymentFailed', this._getFormattedError(error)));
        }
    }

    public async warDeploy(webPackage: string, queryParameters?: Array<string>): Promise<any> {
        let httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.uri = this.client.getRequestUri(`/api/wardeploy`, queryParameters);
        httpRequest.body = fs.createReadStream(webPackage);
        httpRequest.headers = {
            'Content-Type': 'application/octet-stream'
        };

        try {
            let response = await this.client.beginRequest(httpRequest);
            tl.debug(`War Deploy response: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                tl.debug('Deployment passed');
                return null;
            }
            else if (response.statusCode == 202) {
                let pollableURL: string = response.headers.location;
                if (!!pollableURL) {
                    tl.debug(`Polling for War Deploy URL: ${pollableURL}`);
                    return await this._getDeploymentDetailsFromPollURL(pollableURL);
                }
                else {
                    tl.debug('war deploy returned 202 without pollable URL.');
                    return null;
                }
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw new Error(tl.loc('PackageDeploymentFailed', this._getFormattedError(error)));
        }
    }

    public async oneDeploy(webPackage: string, queryParameters?: Array<string>, addChecksumHeader?: boolean): Promise<any> {
        let httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.uri = this.client.getRequestUri(`/api/publish`, queryParameters);

        var rs = fs.createReadStream(webPackage);
        var checksum: string = undefined;

        httpRequest.body = rs;
        httpRequest.headers = httpRequest.headers || {};

        if (addChecksumHeader !== undefined && addChecksumHeader) {
            checksum = await this._computeFileChecksum(rs);
            if (checksum !== undefined){
                httpRequest.headers["x-ms-artifact-checksum"] = checksum;
            }
        }

        let requestOptions = new webClient.WebRequestOptions();
        //Bydefault webclient.sendRequest retries for  [500, 502, 503, 504]
        requestOptions.retriableStatusCodes = [500, 502, 503, 504];
        requestOptions.retryIntervalInSeconds = 5;
        try {
            let response = await this.client.beginRequest(httpRequest, requestOptions, 'application/octet-stream');
            tl.debug(`OneDeploy response: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                tl.debug('Deployment passed');
                return null;
            }
            else if (response.statusCode == 202) {
                let pollableURL: string = response.headers.location;
                if (!!pollableURL) {
                    tl.debug(`Polling for OneDeploy URL: ${pollableURL}`);
                    return await this._getDeploymentDetailsFromPollURL(pollableURL);
                }
                else {
                    tl.debug('OneDeploy returned 202 without pollable URL.');
                    return null;
                }
            }
            else {
                throw response;
            }
        }
        catch (error) {
            throw new Error(tl.loc('PackageDeploymentFailed', this._getFormattedError(error)));
        }
    }

    public async getDeploymentDetails(deploymentID: string): Promise<any> {
        try {
            var httpRequest = new webClient.WebRequest();
            httpRequest.method = 'GET';
            httpRequest.uri = this.client.getRequestUri(`/api/deployments/${deploymentID}`); ;
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getDeploymentDetails. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetDeploymentLogs', this._getFormattedError(error)))
        }
    }

    public async getDeploymentLogs(log_url: string): Promise<any> {
        try {
            var httpRequest = new webClient.WebRequest();
            httpRequest.method = 'GET';
            httpRequest.uri = log_url;
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`getDeploymentLogs. Data: ${JSON.stringify(response)}`);
            if (response.statusCode == 200) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetDeploymentLogs', this._getFormattedError(error)))
        }
    }

    public async deleteFile(physicalPath: string, fileName: string): Promise<void> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'DELETE';
        httpRequest.uri = this.client.getRequestUri(`/api/vfs/${physicalPath}/${fileName}`);
        httpRequest.headers = {
            'If-Match': '*'
        };

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`deleteFile. Data: ${JSON.stringify(response)}`);
            if ([200, 201, 204, 404].indexOf(response.statusCode) != -1) {
                return ;
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw Error(tl.loc('FailedToDeleteFile', physicalPath, fileName, this._getFormattedError(error)));
        }
    }

    public async deleteFolder(physicalPath: string): Promise<void> {
        physicalPath = physicalPath.replace(/[\\]/g, "/");
        physicalPath = physicalPath[0] == "/" ? physicalPath.slice(1): physicalPath;
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'DELETE';
        httpRequest.uri = this.client.getRequestUri(`/api/vfs/${physicalPath}`);
        httpRequest.headers = {
            'If-Match': '*'
        };

        try {
            var response = await this.client.beginRequest(httpRequest);
            tl.debug(`deleteFolder. Data: ${JSON.stringify(response)}`);
            if ([200, 201, 204, 404].indexOf(response.statusCode) != -1) {
                return ;
            }
            else {
                throw response;
            }
        }
        catch(error) {
            throw Error(tl.loc('FailedToDeleteFolder', physicalPath, this._getFormattedError(error)));
        }
    }

    private async _getDeploymentDetailsFromPollURL(pollURL: string): Promise<any> {
        let httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.uri = pollURL;
        httpRequest.headers = {};

        while(true) {
            let response = await this.client.beginRequest(httpRequest);
            if (response.statusCode == 200 || response.statusCode == 202) {
                var result = response.body;
                tl.debug(`POLL URL RESULT: ${JSON.stringify(response)}`);
                if (result.status == KUDU_DEPLOYMENT_CONSTANTS.SUCCESS || result.status == KUDU_DEPLOYMENT_CONSTANTS.FAILED) {
                    return result;
                }
                else {
                    tl.debug(`Deployment status: ${result.status} '${result.status_text}'. retry after 5 seconds`);
                    await webClient.sleepFor(5);
                    continue;
                }
            }
            else {
                throw response;
            }
        }
    }

    private _getFormattedError(error: any) {
        if (error && error.statusCode) {
            return `${error.statusMessage} (CODE: ${error.statusCode})`;
        }
        else if (error && error.message) {
            if (error.statusCode) {
                error.message = `${typeof error.message.valueOf() == 'string' ? error.message : error.message.Code + " - " + error.message.Message } (CODE: ${error.statusCode})`
            }

            return error.message;
        }

        return error;
    }

    private _computeFileChecksum(stream: fs.ReadStream) :Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            stream.on('data', (data) => {
                hash.update(data);
            });

            stream.on('end', () => {
                const result = hash.digest('hex');
                resolve(result);
            });

            stream.on('error', (error) => {
                resolve(undefined);
            });
        });
    }
}
