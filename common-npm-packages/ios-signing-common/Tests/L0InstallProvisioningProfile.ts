import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";
import * as path from "path";

import { setToolProxy } from "./utils";

const tl = require("azure-pipelines-task-lib/mock-task");
const tlClone = Object.assign({}, tl);
const profilePath = "path/to/profile.mobileprovision";
const homePath = path.resolve("test-home");

tlClone.tool = setToolProxy(tlClone.tool);
tlClone.getVariable = variable => variable === "HOME" ? homePath : undefined;
tlClone.mkdirP = () => {};
tlClone.writeFile = () => {};

function createAnswers(profileIdentifier: string, sourceProfilePath: string = profilePath) {
    const profileDirectory = tlClone.resolve(homePath, "Library", "MobileDevice", "Provisioning Profiles");
    const destination = tlClone.resolve(profileDirectory, profileIdentifier + path.extname(sourceProfilePath));

    return {
        "checkPath": {
            "security": true,
            "/usr/libexec/PlistBuddy": true,
            "plistbuddy": true,
            "rm": true,
            "cp": true
        },
        "which": {
            "security": "security",
            "/usr/libexec/PlistBuddy": "plistbuddy",
            "rm": "rm",
            "cp": "cp"
        },
        "exec": {
            [`security cms -D -i ${sourceProfilePath}`]: {
                "stdout": "profile plist",
                "code": 0
            },
            "plistbuddy -c Print UUID _xcodetasktmp.plist": {
                "stdout": profileIdentifier,
                "code": 0
            },
            "plistbuddy -c Print Name _xcodetasktmp.plist": {
                "stdout": "Test Profile",
                "code": 0
            },
            "rm -f _xcodetasktmp.plist": {
                "stdout": "",
                "code": 0
            },
            [`cp -f ${sourceProfilePath} ${destination}`]: {
                "stdout": "",
                "code": 0
            }
        },
        "exist": {}
    };
}

export function installProvisioningProfileTest() {
    before(() => {
        mocker.disable();
        mocker.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    after(() => {
        mocker.deregisterAll();
        mocker.disable();
    });

    beforeEach(() => {
        mocker.resetCache();
    });

    afterEach(() => {
        mocker.deregisterMock("azure-pipelines-task-lib/task");
    });

    it("installs a profile with an opaque identifier", async () => {
        let taskOutput = "";
        tlClone.setAnswers(createAnswers("custom-profile_01"));
        tlClone.setStdStream({
            write: message => taskOutput += message
        });

        mocker.registerMock("azure-pipelines-task-lib/task", tlClone);
        const iosSigning = require("../ios-signing-common");

        const result = await iosSigning.installProvisioningProfile(profilePath);

        assert.strictEqual(result.provProfileUUID, "custom-profile_01");
        assert.ok(taskOutput.indexOf("custom-profile_01.mobileprovision") >= 0);
    });

    [
        { profileIdentifier: "../../outside", sourceProfilePath: profilePath },
        { profileIdentifier: "/tmp/outside", sourceProfilePath: profilePath },
        { profileIdentifier: "nested/profile", sourceProfilePath: profilePath },
        { profileIdentifier: "nested\\profile", sourceProfilePath: profilePath },
        { profileIdentifier: "..", sourceProfilePath: "path/to/profile" }
    ].forEach(({ profileIdentifier, sourceProfilePath }) => {
        it(`rejects path-like profile identifier ${JSON.stringify(profileIdentifier)}`, async () => {
            let taskOutput = "";
            tlClone.setAnswers(createAnswers(profileIdentifier, sourceProfilePath));
            tlClone.setStdStream({
                write: message => taskOutput += message
            });

            mocker.registerMock("azure-pipelines-task-lib/task", tlClone);
            const iosSigning = require("../ios-signing-common");

            await assert.rejects(() => iosSigning.installProvisioningProfile(sourceProfilePath));
            assert.strictEqual(taskOutput.indexOf("cp -f"), -1);
        });
    });
}
