import tl = require('azure-pipelines-task-lib/task');
import { AzureAksService } from './azure-arm-aks-service';
import { AzureRMEndpoint } from './azure-arm-endpoint';
import { AzureEndpoint, AKSClusterAccessProfile, AKSCredentialResult} from './azureModels';


async function getKubeConfigFromAKS(azureSubscriptionEndpoint: string, resourceGroup: string, clusterName: string, useClusterAdmin?: boolean) : Promise<string> {
    const azureEndpoint: AzureEndpoint = await (new AzureRMEndpoint(azureSubscriptionEndpoint)).getEndpoint();
    const aks = new AzureAksService(azureEndpoint);
    const USE_AKS_CREDENTIAL_API = tl.getBoolFeatureFlag('USE_AKS_CREDENTIAL_API');
    tl.debug(tl.loc("KubernetesClusterResourceGroup", clusterName, resourceGroup));
    let base64Kubeconfig;
    if (USE_AKS_CREDENTIAL_API) {
        let clusterInfo : AKSCredentialResult = await aks.getClusterCredential(resourceGroup, clusterName, useClusterAdmin);
        base64Kubeconfig = Buffer.from(clusterInfo.value, 'base64');
    } else {
        let clusterInfo : AKSClusterAccessProfile = await aks.getAccessProfile(resourceGroup, clusterName, useClusterAdmin);
        base64Kubeconfig = Buffer.from(clusterInfo.properties.kubeConfig, 'base64');
    }
    return base64Kubeconfig.toString();
}

export async function getKubeConfig(azureSubscriptionEndpoint, resourceGroup, clusterName, useClusterAdmin): Promise<string> {
    return getKubeConfigFromAKS(azureSubscriptionEndpoint, resourceGroup, clusterName, useClusterAdmin);
}