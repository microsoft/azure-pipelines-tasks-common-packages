import fs = require('fs');
import path = require('path');

import { getHandlerFromToken, WebApi } from 'azure-devops-node-api';
import { TaskHubOidcToken } from 'azure-devops-node-api/interfaces/TaskAgentInterfaces';
import * as tl from 'azure-pipelines-task-lib/task';
import { IExecSyncResult } from 'azure-pipelines-task-lib/toolrunner';

import * as webClient from './webClient';

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export function setAzureCloudBasedOnServiceEndpoint(connectedService: string): void {
    var environment = tl.getEndpointDataParameter(connectedService, 'environment', true);
    if (!!environment) {
        console.log(tl.loc('SettingAzureCloud', environment));
        throwIfError(tl.execSync("az", "cloud set -n " + environment));
    }
}

export async function loginAzureRM(connectedService: string): Promise<void> {
    var authScheme: string = tl.getEndpointAuthorizationScheme(connectedService, true);

    if (authScheme.toLowerCase() == "workloadidentityfederation") {
        var servicePrincipalId: string = tl.getEndpointAuthorizationParameter(connectedService, "serviceprincipalid", false);
        var tenantId: string = tl.getEndpointAuthorizationParameter(connectedService, "tenantid", false);

        const federatedToken = await getFederatedToken(connectedService);
        tl.setSecret(federatedToken);
        const args = `login --service-principal -u "${servicePrincipalId}" --tenant "${tenantId}" --allow-no-subscriptions --federated-token "${federatedToken}"`;

        //login using OpenID Connect federation
        throwIfError(tl.execSync("az", args), tl.loc("LoginFailed"));
    }
    else if (authScheme.toLowerCase() == "serviceprincipal") {
        let authType: string = tl.getEndpointAuthorizationParameter(connectedService, 'authenticationType', true);
        var servicePrincipalId: string = tl.getEndpointAuthorizationParameter(connectedService, "serviceprincipalid", false);
        var tenantId: string = tl.getEndpointAuthorizationParameter(connectedService, "tenantid", false);
        let cliPassword: string = null;
        let isCertificateParameterSupported: boolean = false;
        let authParam: string = "--password";

        const azVersionResult: IExecSyncResult = tl.execSync("az", "--version");
        throwIfError(azVersionResult);
        isCertificateParameterSupported = isAzVersionGreaterOrEqual(azVersionResult.stdout, "2.66.0");

        if (authType == "spnCertificate") {
            tl.debug('certificate based endpoint');
            if(isCertificateParameterSupported) {
                authParam = "--certificate";
            }
            let certificateContent: string = tl.getEndpointAuthorizationParameter(connectedService, "servicePrincipalCertificate", false);
            cliPassword = path.join(tl.getVariable('Agent.TempDirectory') || tl.getVariable('system.DefaultWorkingDirectory'), 'spnCert.pem');
            fs.writeFileSync(cliPassword, certificateContent);
        }
        else {
            tl.debug('key based endpoint');
            cliPassword = tl.getEndpointAuthorizationParameter(connectedService, "serviceprincipalkey", false);
        }

        let escapedCliPassword = cliPassword.replace(/"/g, '\\"');
        tl.setSecret(escapedCliPassword.replace(/\\/g, '\"'));
        //login using svn
        throwIfError(tl.execSync("az", `login --service-principal -u "${servicePrincipalId}" ${authParam}="${escapedCliPassword}" --tenant "${tenantId}" --allow-no-subscriptions`), tl.loc("LoginFailed"));
    }
    else if(authScheme.toLowerCase() == "managedserviceidentity") {
        //login using msi
        throwIfError(tl.execSync("az", "login --identity"), tl.loc("MSILoginFailed"));
    }
    else {
        throw tl.loc('AuthSchemeNotSupported', authScheme);
    }

    var subscriptionID: string = tl.getEndpointDataParameter(connectedService, "SubscriptionID", true);
    if (!!subscriptionID) {
        //set the subscription imported to the current subscription
        throwIfError(tl.execSync("az", "account set --subscription \"" + subscriptionID + "\""), tl.loc("ErrorInSettingUpSubscription"));
    }
}

function throwIfError(resultOfToolExecution: IExecSyncResult, errormsg?: string): void {
    if (resultOfToolExecution.code != 0) {
        tl.error("Error Code: [" + resultOfToolExecution.code + "]");
        if (errormsg) {
            tl.error("Error: " + errormsg);
        }
        throw resultOfToolExecution;
    }
}

function getSystemAccessToken(): string {
    tl.debug('Getting credentials for account feeds');
    let auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
    if (auth && auth.scheme === 'OAuth') {
        tl.debug('Got auth token, setting it as secret so it does not print in console log');
        tl.setSecret(auth.parameters['AccessToken']);
        return auth.parameters['AccessToken'];
    }
    tl.warning(tl.loc('FeedTokenUnavailable'));
    return '';
}

export async function getFederatedToken(connectedServiceName: string): Promise<string> {
    const projectId: string = tl.getVariable("System.TeamProjectId");
    const hub: string = tl.getVariable("System.HostType");
    const planId: string = tl.getVariable('System.PlanId');
    const jobId: string = tl.getVariable('System.JobId');
    let uri = tl.getVariable("System.CollectionUri");
    if (!uri) {
        uri = tl.getVariable("System.TeamFoundationServerUri");
    }

    const token = getSystemAccessToken();
    const authHandler = getHandlerFromToken(token);
    const connection = new WebApi(uri, authHandler);
    const oidc_token: string = await initOIDCToken(
        connection,
        projectId,
        hub,
        planId,
        jobId,
        connectedServiceName,
        0,
        2000);

    tl.setSecret(oidc_token);

    return oidc_token;
}

export async function initOIDCToken(connection: WebApi, projectId: string, hub: string, planId: string, jobId: string, serviceConnectionId: string, retryCount: number = 0, timeToWait: number = 2000): Promise<string> {
    const taskApi = await connection.getTaskApi();

    let token: TaskHubOidcToken;

    try {
        token = await taskApi.createOidcToken({}, projectId, hub, planId, jobId, serviceConnectionId)
    } catch (error) {
        // Handle AggregateError if available, since the package uses Node10 types.
        // Otherwise handle generic error
        if (error.name === 'AggregateError' && error['errors'] !== undefined) {
            for (const err of error.errors) {
                tl.error(err);
            }
        } else {
            tl.error(error);
        }
        return Promise.reject(tl.loc('CouldNotFetchAccessTokenforAAD') + " " + error);
    }

    if (token != null) {
        tl.debug('Got OIDC token');
        return Promise.resolve(token.oidcToken);
    }

    if (token.oidcToken === null && retryCount >= 3) {
        return Promise.reject(tl.loc('CouldNotFetchAccessTokenforAAD'));
    }

    retryCount += 1;

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(initOIDCToken(connection, projectId, hub, planId, jobId, serviceConnectionId, retryCount, timeToWait));
        }, timeToWait * retryCount);
    });
}

function isAzVersionGreaterOrEqual(azVersionResultOutput: string, versionToCompare: string): boolean {
    try {
        const versionMatch = azVersionResultOutput.match(/azure-cli\s+(\d+\.\d+\.\d+)/);

        if (!versionMatch || versionMatch.length < 2) {
            tl.error(`Can't parse az version from: ${azVersionResultOutput}`);
            return false;
        }

        const currentVersion = versionMatch[1];
        tl.debug(`Current Azure CLI version: ${currentVersion}`);

        // Parse both versions into major, minor, patch components
        const [currentMajor, currentMinor, currentPatch] = currentVersion.split('.').map(Number);
        const [compareMajor, compareMinor, comparePatch] = versionToCompare.split('.').map(Number);

        // Compare versions
        if (currentMajor > compareMajor) return true;
        if (currentMajor < compareMajor) return false;

        if (currentMinor > compareMinor) return true;
        if (currentMinor < compareMinor) return false;

        return currentPatch >= comparePatch;
    } catch (error) {
        tl.error(`Error checking Azure CLI version: ${error.message}`);
        return false;
    }
}

async function getLatestAzureModuleReleaseVersion(moduleName: string): Promise<string> {
    try {
        let request = new webClient.WebRequest();
        request.uri = `https://api.github.com/repos/Azure/${moduleName}/releases`;
        request.method = 'GET';
        request.headers = request.headers || {};
        const response = await webClient.sendRequest(request);
        const lastestCliRelease = moduleName === "azure-powershell" ? response?.body?.filter(x => x?.tag_name?.match(/^v\d+\.\d+\.0/))?.[0] : response?.body?.[0];
        return lastestCliRelease?.tag_name
    } catch (err) {
        tl.error(`Error checking Azure version: ${err.message}`);
    }
}

export async function validateAzModuleVersion(moduleName: string, currentVersion: string, displayName: string, versionTolerance: number, checkOnlyMajorVersion: boolean = false): Promise<void> {
    const DisplayWarningForOlderAzVersion: boolean = tl.getPipelineFeature("ShowWarningOnOlderAzureModules");
    try {
        if (DisplayWarningForOlderAzVersion) {
            const latestRelease: string = await getLatestAzureModuleReleaseVersion(moduleName);
            if (latestRelease) {
                const [latestsemver, latestMajor, latestMinor] = latestRelease.match(/(\d+).(\d+).(\d+)/);
                const [currentsemver, currentMajor, currentMinor] = currentVersion.match(/(\d+).(\d+).(\d+)/);
                tl.debug(`For the module ${moduleName} the current semver Version is ${currentsemver} and the latest semver version is ${latestsemver}`)
                let displayWarning = false;
                if (checkOnlyMajorVersion && Number(currentMajor) < Number(latestMajor) - versionTolerance) {
                    displayWarning = true;
                }
                if (!checkOnlyMajorVersion && (Number(currentMajor) < Number(latestMajor) || Number(currentMinor) < Number(latestMinor) - versionTolerance)) {
                    displayWarning = true;
                }
                if (displayWarning) {
                    tl.warning(tl.loc('lowerAzWarning', displayName, currentsemver, latestsemver))
                }
            }
        }
    } catch (err) {
        tl.error(`Error on validating Azure version: ${err.message}`);
    }
}