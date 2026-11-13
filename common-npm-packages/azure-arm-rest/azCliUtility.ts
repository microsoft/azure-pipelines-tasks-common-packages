import fs = require('fs');
import path = require('path');

import { getHandlerFromToken, WebApi } from 'azure-devops-node-api';
import * as tl from 'azure-pipelines-task-lib/task';
import { IExecSyncResult } from 'azure-pipelines-task-lib/toolrunner';
import Q = require('q');

import * as webClient from './webClient';
import { ITaskApi } from 'azure-devops-node-api/TaskApi';
import { TaskHubOidcToken } from 'azure-devops-node-api/interfaces/TaskAgentInterfaces';

// Maximum number of retries for creating OIDC token
const MAX_CREATE_OIDC_TOKEN_RETRIES = 3;

// Maximum backoff timeout for creating OIDC token in milliseconds
const MAX_CREATE_OIDC_TOKEN_BACKOFF_TIMEOUT = 15000;

// Isolation is on by default; setting this pipeline feature to true restores the legacy fixed-path behavior.
const DISABLE_CREDENTIAL_FILE_ISOLATION_FEATURE = 'DisableAzureArmRestCredentialFileIsolation';
const CREDENTIAL_DIRECTORY_PREFIX = '.azarmrest-credentials-';
const CERTIFICATE_FILE_NAME = 'spnCert.pem';

// Isolated directories not cleaned up by the caller are removed, at the latest, when the process exits.
const isolatedCredentialDirectories: Set<string> = new Set<string>();
let exitCleanupRegistered: boolean = false;

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

/**
 * Credential files created by loginAzureRM. Azure CLI re-reads the certificate file on every
 * command after login, so callers must keep it until their last az invocation and then pass
 * this object to cleanupAzureRMLoginCredentials.
 */
export interface AzureRMLoginCredentials {
    certificatePath?: string;
    directoryPath?: string;
}

function createIsolatedCertificateFile(certificateContent: string): AzureRMLoginCredentials {
    const agentTempDirectory: string = tl.getVariable('Agent.TempDirectory');
    if (!agentTempDirectory) {
        throw new Error('Agent.TempDirectory is required for Azure CLI certificate credentials.');
    }

    const directoryPath = fs.mkdtempSync(path.join(agentTempDirectory, CREDENTIAL_DIRECTORY_PREFIX));
    trackIsolatedCredentialDirectory(directoryPath);
    const certificatePath = path.join(directoryPath, CERTIFICATE_FILE_NAME);
    try {
        if (process.platform !== 'win32') {
            fs.chmodSync(directoryPath, 0o700);
        }
        fs.writeFileSync(certificatePath, certificateContent, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return { certificatePath, directoryPath };
    } catch (error) {
        cleanupAzureRMLoginCredentials({ certificatePath, directoryPath });
        throw error;
    }
}

function trackIsolatedCredentialDirectory(directoryPath: string): void {
    isolatedCredentialDirectories.add(directoryPath);
    if (!exitCleanupRegistered) {
        exitCleanupRegistered = true;
        process.once('exit', cleanupAzureRMLoginCredentialsOnExit);
    }
}

function cleanupAzureRMLoginCredentialsOnExit(): void {
    isolatedCredentialDirectories.forEach((directoryPath: string) => cleanupIsolatedCredentialDirectory(directoryPath, 'exit'));
}

/**
 * Removes credential files created by loginAzureRM: the isolated credential directory or, when
 * isolation is disabled, the legacy fixed-path certificate file. Never throws so it is safe to
 * call from finally blocks.
 */
export function cleanupAzureRMLoginCredentials(credentials?: AzureRMLoginCredentials): void {
    if (!credentials) {
        return;
    }

    if (credentials.directoryPath) {
        cleanupIsolatedCredentialDirectory(credentials.directoryPath, 'explicit');
    }
    else if (credentials.certificatePath) {
        cleanupLegacyCertificateFile(credentials.certificatePath);
    }
}

function cleanupIsolatedCredentialDirectory(directoryPath: string, trigger: 'explicit' | 'exit'): void {
    // Untrack before removing so the exit handler never retries or double-reports a directory.
    isolatedCredentialDirectories.delete(directoryPath);

    let outcome: string;
    try {
        outcome = removeIsolatedCredentialDirectory(directoryPath);
        if (outcome === 'rejected') {
            tl.warning('Skipped removing the Azure CLI service-principal certificate credentials because the credential directory is not valid.');
        }
    } catch (error) {
        outcome = 'error';
        tl.warning('Failed to remove the Azure CLI service-principal certificate credentials.');
        tl.debug(`Failed to remove the Azure CLI certificate credential directory: ${error && error.code || error}`);
    }

    publishCertificateCredentialTelemetry({ cleanup: outcome, trigger: trigger });
}

function cleanupLegacyCertificateFile(certificatePath: string): void {
    let outcome: string;
    try {
        outcome = removeLegacyCertificateFile(certificatePath);
        if (outcome === 'rejected') {
            tl.warning('Skipped removing the Azure CLI service-principal certificate because the certificate path is not a regular file at the expected location.');
        }
    } catch (error) {
        outcome = 'error';
        tl.warning('Failed to remove the Azure CLI service-principal certificate.');
        tl.debug(`Failed to remove the Azure CLI legacy certificate file: ${error && error.code || error}`);
    }

    publishCertificateCredentialTelemetry({ isolation: 'disabled', cleanup: outcome, trigger: 'explicit' });
}

function getLegacyCertificatePath(): string {
    return path.join(tl.getVariable('Agent.TempDirectory') || tl.getVariable('system.DefaultWorkingDirectory'), CERTIFICATE_FILE_NAME);
}

// Only unlinks a regular file at the legacy location; links and directories are never followed or removed.
function removeLegacyCertificateFile(certificatePath: string): 'deleted' | 'notfound' | 'rejected' {
    if (!isSamePath(certificatePath, getLegacyCertificatePath())) {
        return 'rejected';
    }

    let fileStats: fs.Stats;
    try {
        fileStats = fs.lstatSync(certificatePath);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return 'notfound';
        }
        throw error;
    }

    if (!fileStats.isFile()) {
        return 'rejected';
    }

    fs.unlinkSync(certificatePath);
    return 'deleted';
}

// Deliberately avoids tl.rmRF, which follows directory links (symlinks/junctions) and deletes their targets.
function removeIsolatedCredentialDirectory(directoryPath: string): 'deleted' | 'notfound' | 'rejected' {
    const agentTempDirectory: string = tl.getVariable('Agent.TempDirectory');
    if (!agentTempDirectory
        || !isSamePath(path.dirname(directoryPath), agentTempDirectory)
        || path.basename(directoryPath).indexOf(CREDENTIAL_DIRECTORY_PREFIX) !== 0) {
        return 'rejected';
    }

    let directoryStats: fs.Stats;
    try {
        directoryStats = fs.lstatSync(directoryPath);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return 'notfound';
        }
        throw error;
    }

    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
        return 'rejected';
    }

    try {
        fs.unlinkSync(path.join(directoryPath, CERTIFICATE_FILE_NAME));
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    fs.rmdirSync(directoryPath);
    return 'deleted';
}

function isSamePath(first: string, second: string): boolean {
    const resolvedFirst = path.resolve(first);
    const resolvedSecond = path.resolve(second);
    return process.platform === 'win32'
        ? resolvedFirst.toLowerCase() === resolvedSecond.toLowerCase()
        : resolvedFirst === resolvedSecond;
}

// Only fixed values are published: isolation (enabled|disabled), login (succeeded|failed),
// cleanup (deleted|notfound|rejected|error) with trigger (explicit|exit).
function publishCertificateCredentialTelemetry(properties: { [key: string]: string }): void {
    try {
        console.log(`##vso[telemetry.publish area=TaskDeploymentMethod;feature=AzureRMLoginCertificateCredentials]${JSON.stringify(properties)}`);
    } catch (error) {
        tl.debug(`Failed to publish Azure CLI certificate credential telemetry: ${error}`);
    }
}

export function setAzureCloudBasedOnServiceEndpoint(connectedService: string, azureCliPath: string = "az"): void {
    var environment = tl.getEndpointDataParameter(connectedService, 'environment', true);
    if (!!environment) {
        console.log(tl.loc('SettingAzureCloud', environment));
        throwIfError(tl.execSync(azureCliPath, "cloud set -n " + environment));
    }
}

export async function loginAzureRM(connectedService: string, azureCliPath: string = "az"): Promise<AzureRMLoginCredentials> {
    var authScheme: string = tl.getEndpointAuthorizationScheme(connectedService, true);
    const credentials: AzureRMLoginCredentials = {};
    const certificateLogin: { isolation?: string } = {};

    try {
        await loginAzureRMWithScheme(connectedService, azureCliPath, authScheme, credentials, certificateLogin);
    } catch (error) {
        publishCertificateLoginTelemetry(certificateLogin, 'failed');
        // The legacy fixed-path file is intentionally left in place on failure, matching the previous behavior.
        if (credentials.directoryPath) {
            cleanupAzureRMLoginCredentials(credentials);
        }
        throw error;
    }

    publishCertificateLoginTelemetry(certificateLogin, 'succeeded');
    return credentials;
}

function publishCertificateLoginTelemetry(certificateLogin: { isolation?: string }, login: string): void {
    if (certificateLogin.isolation) {
        publishCertificateCredentialTelemetry({ isolation: certificateLogin.isolation, login: login });
    }
}

async function loginAzureRMWithScheme(connectedService: string, azureCliPath: string, authScheme: string, credentials: AzureRMLoginCredentials, certificateLogin: { isolation?: string }): Promise<void> {
    if (authScheme.toLowerCase() == "workloadidentityfederation") {
        var servicePrincipalId: string = tl.getEndpointAuthorizationParameter(connectedService, "serviceprincipalid", false);
        var tenantId: string = tl.getEndpointAuthorizationParameter(connectedService, "tenantid", false);

        const federatedToken = await getFederatedToken(connectedService);
        tl.setSecret(federatedToken);
        const args = `login --service-principal -u "${servicePrincipalId}" --tenant "${tenantId}" --allow-no-subscriptions --federated-token "${federatedToken}"`;

        //login using OpenID Connect federation
        throwIfError(tl.execSync(azureCliPath, args), tl.loc("LoginFailed"));
    }
    else if (authScheme.toLowerCase() == "serviceprincipal") {
        let authType: string = tl.getEndpointAuthorizationParameter(connectedService, 'authenticationType', true);
        var servicePrincipalId: string = tl.getEndpointAuthorizationParameter(connectedService, "serviceprincipalid", false);
        var tenantId: string = tl.getEndpointAuthorizationParameter(connectedService, "tenantid", false);
        let cliPassword: string = null;
        let isCertificateParameterSupported: boolean = false;
        let authParam: string = "--password";

        const azVersionResult: IExecSyncResult = tl.execSync(azureCliPath, "--version");
        throwIfError(azVersionResult);
        isCertificateParameterSupported = isAzVersionGreaterOrEqual(azVersionResult.stdout, "2.66.0");

        if (authType == "spnCertificate") {
            tl.debug('certificate based endpoint');
            if(isCertificateParameterSupported) {
                authParam = "--certificate";
            }
            let certificateContent: string = tl.getEndpointAuthorizationParameter(connectedService, "servicePrincipalCertificate", false);
            if (!tl.getPipelineFeature(DISABLE_CREDENTIAL_FILE_ISOLATION_FEATURE)) {
                certificateLogin.isolation = 'enabled';
                const isolatedCertificate = createIsolatedCertificateFile(certificateContent);
                credentials.certificatePath = isolatedCertificate.certificatePath;
                credentials.directoryPath = isolatedCertificate.directoryPath;
                cliPassword = isolatedCertificate.certificatePath;
            }
            else {
                certificateLogin.isolation = 'disabled';
                cliPassword = getLegacyCertificatePath();
                fs.writeFileSync(cliPassword, certificateContent);
                credentials.certificatePath = cliPassword;
            }
        }
        else {
            tl.debug('key based endpoint');
            cliPassword = tl.getEndpointAuthorizationParameter(connectedService, "serviceprincipalkey", false);
        }

        let escapedCliPassword = cliPassword.replace(/"/g, '\\"');
        tl.setSecret(escapedCliPassword.replace(/\\/g, '\"'));
        //login using svn
        throwIfError(tl.execSync(azureCliPath, `login --service-principal -u "${servicePrincipalId}" ${authParam}="${escapedCliPassword}" --tenant "${tenantId}" --allow-no-subscriptions`), tl.loc("LoginFailed"));
    }
    else if(authScheme.toLowerCase() == "managedserviceidentity") {
        //login using msi
        throwIfError(tl.execSync(azureCliPath, "login --identity"), tl.loc("MSILoginFailed"));
    }
    else {
        throw tl.loc('AuthSchemeNotSupported', authScheme);
    }

    var subscriptionID: string = tl.getEndpointDataParameter(connectedService, "SubscriptionID", true);
    if (!!subscriptionID) {
        //set the subscription imported to the current subscription
        throwIfError(tl.execSync(azureCliPath, "account set --subscription \"" + subscriptionID + "\""), tl.loc("ErrorInSettingUpSubscription"));
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
        connectedServiceName);

    tl.setSecret(oidc_token);

    return oidc_token;
}

function initOIDCToken(connection: WebApi, projectId: string, hub: string, planId: string, jobId: string, serviceConnectionId: string, retryCount: number = 0, timeToWait: number = 2000): Promise<string> {
    if (tl.getPipelineFeature("UseOIDCToken2InAzureArmRest")) {
        return initOIDCToken2(connection, projectId, hub, planId, jobId, serviceConnectionId, retryCount, timeToWait);
    }

    return new Promise<string>((resolve, reject) => {
        connection.getTaskApi().then(
            (taskApi: ITaskApi) => {
                taskApi.createOidcToken({}, projectId, hub, planId, jobId, serviceConnectionId).then(
                    (response: TaskHubOidcToken) => {
                        if (response != null) {
                            tl.debug('Got OIDC token');
                            resolve(response.oidcToken);
                        }
                        else if (response.oidcToken == null) {
                            if (retryCount < 3) {
                                let waitedTime = timeToWait;
                                retryCount += 1;
                                setTimeout(() => {
                                    resolve(initOIDCToken(connection, projectId, hub, planId, jobId, serviceConnectionId, retryCount, waitedTime));
                                }, waitedTime);
                            }
                            else {
                                reject(tl.loc('CouldNotFetchAccessTokenforAAD'));
                            }
                        }
                    },
                    (error) => {
                        reject(tl.loc('CouldNotFetchAccessTokenforAAD') + " " + error);
                    }
                );
            }
        );
    });
}

export async function initOIDCToken2(
    connection: WebApi,
    projectId: string,
    hub: string,
    planId: string,
    jobId: string,
    serviceConnectionId: string,
    retryCount: number = 0,
    timeToWait: number = 2000
): Promise<string> {
    const taskApi = await connection.getTaskApi();

    try {
        const token = await taskApi.createOidcToken({}, projectId, hub, planId, jobId, serviceConnectionId);

        // If the token is null or undefined, it means the OIDC token could not be fetched
        if (!token?.oidcToken) {
            throw new Error(tl.loc('CouldNotFetchAccessTokenforAAD'));
        }

        tl.debug('Got OIDC token');
        return token.oidcToken;
    } catch (error) {
        // Handle AggregateError if available, since the package uses Node10 types.
        // Otherwise handle generic error
        if (error.name === 'AggregateError' && error['errors'] !== undefined) {
            for (const err of error.errors) {
                tl.error(`Error while trying to get OIDC token: ${err}`);
            }
        } else {
            tl.error(`Error while trying to get OIDC token: ${error}`);
        }

        if (retryCount >= MAX_CREATE_OIDC_TOKEN_RETRIES) {
            throw Error(tl.loc('CouldNotFetchAccessTokenForAADRetryLimitExceeded'));
        }

        retryCount += 1;
        tl.debug(`Retrying OIDC token fetch. Retries left: ${MAX_CREATE_OIDC_TOKEN_RETRIES - retryCount}`);

        // Wait for a backoff time before retrying
        await new Promise(resolve => setTimeout(resolve, Math.min(timeToWait * retryCount, MAX_CREATE_OIDC_TOKEN_BACKOFF_TIMEOUT)));
        return initOIDCToken2(connection, projectId, hub, planId, jobId, serviceConnectionId, retryCount, timeToWait);
    }
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
        const enableRequestTimeout = tl.getPipelineFeature("EnableAzureModuleVersionCheckRequestTimeout");
        const response = enableRequestTimeout
            ? await webClient.sendRequest(request, Object.assign(new webClient.WebRequestOptions(), {
                retryCount: 1,
                requestTimeout: 3000,
                suppressErrorIssue: true
            }))
            : await webClient.sendRequest(request);
        const lastestCliRelease = moduleName === "azure-powershell" ? response?.body?.filter(x => x?.tag_name?.match(/^v\d+\.\d+\.0/))?.[0] : response?.body?.[0];
        return lastestCliRelease?.tag_name
    } catch (err) {
        tl.debug(`Error checking Azure version: ${err.message}. Hence skipping the check for latest version of ${moduleName}.`);
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
        tl.debug(`Error on validating Azure version: ${err.message}. Hence skipping the check for latest version of ${moduleName}.`);
    }
}
