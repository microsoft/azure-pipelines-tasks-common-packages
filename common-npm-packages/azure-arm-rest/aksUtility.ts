import tl = require('azure-pipelines-task-lib/task');
import { AzureAksService } from './azure-arm-aks-service';
import { AzureRMEndpoint } from './azure-arm-endpoint';
import { AzureEndpoint, AKSClusterAccessProfile, AKSCredentialResult} from './azureModels';



async function getKubeConfigFromAKS(azureSubscriptionEndpoint: string, resourceGroup: string, name: string, isFleet: boolean, useClusterAdmin?: boolean): Promise<string> {
    const azureEndpoint: AzureEndpoint = await (new AzureRMEndpoint(azureSubscriptionEndpoint)).getEndpoint();
    const aks = new AzureAksService(azureEndpoint);
    tl.debug(tl.loc("KubernetesClusterResourceGroup", name, resourceGroup));
    let base64Kubeconfig;

    const USE_AKS_CREDENTIAL_API = tl.getBoolFeatureFlag('USE_AKS_CREDENTIAL_API');
    if (USE_AKS_CREDENTIAL_API) {
        let clusterInfo: AKSCredentialResult = await aks.getClusterCredential(resourceGroup, name, useClusterAdmin);
        base64Kubeconfig = Buffer.from(clusterInfo.value, 'base64');
    } else {
        let clusterInfo: AKSClusterAccessProfile = await aks.getAccessProfile(resourceGroup, name, useClusterAdmin);
        base64Kubeconfig = Buffer.from(clusterInfo.properties.kubeConfig, 'base64');
    }

    return base64Kubeconfig.toString();
}

export async function getKubeConfigFromFleet(azureSubscriptionEndpoint, resourceGroup, fleetName): Promise<string> {
  tl.debug(tl.loc("KubernetesClusterResourceGroup", name, resourceGroup));
  const azureEndpoint: AzureEndpoint = await (new AzureRMEndpoint(azureSubscriptionEndpoint)).getEndpoint();
  const aks = new AzureAksService(azureEndpoint);
  let clusterInfo: AKSCredentialResult = await aks.getFleetCredential(resourceGroup, fleetName);
  let base64Kubeconfig = Buffer.from(clusterInfo.value, 'base64');
  return base64Kubeconfig.toString();
}


export async function getKubeConfig(azureSubscriptionEndpoint, resourceGroup, clusterName, useClusterAdmin): Promise<string> {
    return getKubeConfigFromAKS(azureSubscriptionEndpoint, resourceGroup, clusterName, false, useClusterAdmin);
}

export async function getKubeConfigForFleet(azureSubscriptionEndpoint, resourceGroup, fleetName): Promise<string> {
    return getKubeConfigFromFleet(azureSubscriptionEndpoint, resourceGroup, fleetName);
}