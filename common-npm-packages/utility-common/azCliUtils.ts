import fs = require("fs");
import path = require("path");
import * as tl from 'azure-pipelines-task-lib/task';
import { IExecSyncResult } from 'azure-pipelines-task-lib/toolrunner';
import { getFederatedToken } from './accesstoken';

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

        if (authType == "spnCertificate") {
            tl.debug('certificate based endpoint');
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
        throwIfError(tl.execSync("az", `login --service-principal -u "${servicePrincipalId}" --password="${escapedCliPassword}" --tenant "${tenantId}" --allow-no-subscriptions`), tl.loc("LoginFailed"));
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