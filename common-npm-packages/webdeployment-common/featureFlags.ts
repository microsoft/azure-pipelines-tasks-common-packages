import * as tl from 'azure-pipelines-task-lib/task';

export const WebDeploymentCompatibilityFixEnabled = 'WebDeploymentCompatibilityFixEnabled';

export function isWebDeploymentCompatibilityFixEnabled(): boolean {
    const featureValue = process.env['DISTRIBUTEDTASK_TASKS_' + WebDeploymentCompatibilityFixEnabled.toUpperCase()];
    if (!featureValue) {
        return true;
    }

    const normalizedFeatureValue = featureValue.toLowerCase();
    if (normalizedFeatureValue !== 'true' && normalizedFeatureValue !== 'false') {
        throw new Error(tl.loc('WebDeploymentInvalidCompatibilityFlag',
            'DistributedTask.Tasks.' + WebDeploymentCompatibilityFixEnabled));
    }

    return tl.getPipelineFeature(WebDeploymentCompatibilityFixEnabled);
}
