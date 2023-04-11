import * as mockery from "mockery";
import * as assert from "assert";
import * as semver from 'semver';

export function nugettoolgetter() {
    before(() => {
        mockery.disable(); // needed to ensure that we can mock vsts-task-lib/task
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        } as mockery.MockeryEnableArgs);
    });

    after(() => {
        mockery.disable();
    });

    beforeEach(() => {
        mockery.resetCache();
    });

    afterEach(() => {
        mockery.deregisterAll();
    });
    
    it("Resolve correct nuget version based on msbuild 17", async() => {    
        mockery.registerMock("../../nuget/NuGetToolGetter", {
            getMSBuildVersionString: function() {
                return "17.1.0.0";
            },
            getMSBuildVersion: function() {
                return "17.1.0";
            },
            resolveNuGetVersion: function() {
                let nugetVersionToUse : string;
                const msbuildSemVer = "17.1.0";
                // Default to 6.4.0 if we're using MSBuild 17.0.0 or higher
                // Default to 5.9.3 if we're using MSBuild 16.11.0 or higher, older MSBuild versions are not supported
                // Default to 4.9.6 if we're using MSBuild older than 16.11.0
                if (msbuildSemVer && semver.gte(msbuildSemVer, '17.0.0')) {
                    nugetVersionToUse = '6.4.0';
                } else if (msbuildSemVer && semver.gte(msbuildSemVer, '16.11.0')) {
                    nugetVersionToUse = '5.9.3';
                } else {
                    nugetVersionToUse = this.DEFAULT_NUGET_VERSION;
                }
            
                return nugetVersionToUse;
            },
            DEFAULT_NUGET_VERSION: '4.9.6',
        } );
        let ngToolGetterMock = require("./nugetToolGetterMock");
        let msbuildVersion : string = await ngToolGetterMock.getMSBuildVersionString();
        assert.equal(msbuildVersion, "17.1.0.0");
        let nugetVersion = await ngToolGetterMock.resolveNuGetVersion();
        assert.equal(nugetVersion, "6.4.0");
    });

    it("Resolve correct nuget version based on msbuild 16", async() => {    
        mockery.registerMock("../../nuget/NuGetToolGetter", {
            getMSBuildVersionString: function() {
                return "16.12.0.0";
            },
            getMSBuildVersion: function() {
                return "16.12.0";
            },
            resolveNuGetVersion: function() {
                let nugetVersionToUse : string;
                const msbuildSemVer = "16.12.0";
                // Default to 6.4.0 if we're using MSBuild 17.0.0 or higher
                // Default to 5.9.3 if we're using MSBuild 16.11.0 or higher, older MSBuild versions are not supported
                // Default to 4.9.6 if we're using MSBuild older than 16.11.0
                if (msbuildSemVer && semver.gte(msbuildSemVer, '17.0.0')) {
                    nugetVersionToUse = '6.4.0';
                } else if (msbuildSemVer && semver.gte(msbuildSemVer, '16.11.0')) {
                    nugetVersionToUse = '5.9.3';
                } else {
                    nugetVersionToUse = this.DEFAULT_NUGET_VERSION;
                }
            
                return nugetVersionToUse;
            },
            DEFAULT_NUGET_VERSION: '4.9.6',
        } );
        let ngToolGetterMock = require("./nugetToolGetterMock");
        let msbuildVersion : string = await ngToolGetterMock.getMSBuildVersionString();
        assert.equal(msbuildVersion, "16.12.0.0");
        let nugetVersion = await ngToolGetterMock.resolveNuGetVersion();
        assert.equal(nugetVersion, "5.9.3");
    });
}