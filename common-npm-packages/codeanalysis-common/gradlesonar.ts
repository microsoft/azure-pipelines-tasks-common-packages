import Q = require('q');
import path = require('path');
import fs = require('fs');

import * as tl from 'azure-pipelines-task-lib/task';
import * as trm from 'azure-pipelines-task-lib/toolrunner';
import * as semver from 'semver';

// Apply arguments to enable SonarQube analysis.
// Returns the changed toolRunner. Has no effect if SonarQube is not enabled.
export function applyEnabledSonarQubeArguments(gradleRun: trm.ToolRunner | any): trm.ToolRunner | any {

    const specifyPluginVersion = tl.getInput('sqGradlePluginVersionChoice') === 'specify';
    const pluginVersion: string = getSonarQubeGradlePluginVersion();
    if (specifyPluginVersion) {
        // #1: Inject custom script to the Gradle build, triggering a SonarQube run
        // Add a custom initialisation script to the Gradle run that will apply the SonarQube plugin and task
        // Set the SonarQube Gradle plugin version in the script
        let initScriptPath: string = path.join(__dirname, 'sonar.gradle');
        let scriptContents: string= fs.readFileSync(initScriptPath, 'utf8');
        scriptContents = scriptContents.replace('SONARQUBE_GRADLE_PLUGIN_VERSION', pluginVersion);
        tl.writeFile(initScriptPath, scriptContents);
        // Specify that the build should run the init script
        gradleRun.arg(['-I', initScriptPath]);
    }

    if(semver.gte(pluginVersion, '3.5.0')) {
        gradleRun.arg(['sonar']);
    } else {
        gradleRun.arg(['sonarqube']);
    }

    return gradleRun;
}

function getSonarQubeGradlePluginVersion(): string {
    const defaultPluginVersion = '2.6.1';  
    const sqGradlePluginVersionChoice = tl.getInput('sqGradlePluginVersionChoice');  
    const sqGradlePluginVersion = tl.getInput('sqGradlePluginVersion').trim();  

    return sqGradlePluginVersionChoice === 'specify' && sqGradlePluginVersion  
        ? sqGradlePluginVersion  
        : defaultPluginVersion;
}