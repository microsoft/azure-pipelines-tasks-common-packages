import path = require("path");
import * as api from 'azure-devops-node-api';
import { IRequestOptions } from 'azure-devops-node-api/interfaces/common/VsoBaseInterfaces';
import * as tl from 'azure-pipelines-task-lib/task';

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export function requireHttpsUrl(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(tl.loc("Error_ServiceUrlInvalid"));
    }

    if (url.protocol.toLowerCase() !== "https:") {
        throw new Error(tl.loc("Error_ServiceUrlHttpsRequired"));
    }
    if (url.username || url.password) {
        throw new Error(tl.loc("Error_ServiceUrlInvalid"));
    }

    return url;
}

export function getSystemServiceUrl(): URL {
    const endpointUrl = requireHttpsUrl(
        tl.getEndpointUrl("SYSTEMVSSCONNECTION", false)
    );
    const collectionUrlValues = [
        tl.getVariable("System.CollectionUri"),
        tl.getVariable("System.TeamFoundationCollectionUri")
    ].filter((value): value is string => !!value);

    if (collectionUrlValues.length === 0) {
        throw new Error(tl.loc("Error_ServiceUrlMissingCollectionUrl"));
    }

    for (const collectionUrlValue of collectionUrlValues) {
        const collectionUrl = requireHttpsUrl(collectionUrlValue);
        if (normalizeServiceRoot(endpointUrl) !== normalizeServiceRoot(collectionUrl)) {
            throw new Error(tl.loc("Error_SystemConnectionUrlMismatch"));
        }
    }

    return endpointUrl;
}

export function getWebApiWithProxy(serviceUri: string, accessToken: string, options: IRequestOptions = {}): api.WebApi {
    serviceUri = requireHttpsUrl(serviceUri).href;
    const credentialHandler = api.getBasicHandler('vsts', accessToken);
    const defaultOptions: IRequestOptions = {
        proxy: tl.getHttpProxyConfiguration(serviceUri),
        allowRetries: true,
        maxRetries: 5,
        maxRedirects: 0,
        keepAlive: true
    };

    return new api.WebApi(serviceUri, credentialHandler, {...defaultOptions, ...options});
}

/** Return a masked SystemAccessToken */
export function getSystemAccessToken(): string {
    tl.debug('Getting credentials for local feeds');
    const auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
    if (auth.scheme === 'OAuth') {
        tl.debug(tl.loc("Info_GotAndMaskAuth"));
        tl.setSecret(auth.parameters['AccessToken']);
        return auth.parameters['AccessToken'];
    } else {
        tl.warning('Could not determine credentials to use');
    }
}

function normalizeServiceRoot(url: URL): string {
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
