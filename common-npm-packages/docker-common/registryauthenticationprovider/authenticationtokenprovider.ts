import * as tl from 'azure-pipelines-task-lib/task';

import RegistryAuthenticationToken from './registryauthenticationtoken'

export abstract class AuthenticationTokenProvider {
    // get registry login creds
    public abstract getAuthenticationToken(): RegistryAuthenticationToken | null;

    protected getXMetaSourceClient(): string {
        var serverType = tl.getVariable('System.ServerType');
        return (serverType && serverType.toLowerCase() === 'hosted') ? 'VSTS' : 'TFS';
    }
}

export default AuthenticationTokenProvider;