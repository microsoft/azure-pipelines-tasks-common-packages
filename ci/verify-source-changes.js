var path = require('path');
var process = require("process");
var util = require('./ci-util');

packagesList = util.getDirectories(util.commonPackagesSourcePath);

console.log(`Checking packages sources for uncommitted changes...`);
packagesList.forEach(function(packageName) {
    console.log(`====================${packageName}====================`);

    var packageSourcePath = path.join(util.commonPackagesSourcePath, packageName);

    var diffString = util.run(`git diff --name-only ${packageSourcePath}`);
    var diffList = diffString.split("\n").filter(Boolean);

    if (diffList.length) {
        console.log(``);
        console.log(`Uncommitted changes found:`);
        console.log(``);
        diffList.forEach(function(item){
            console.log(` - ${item}`);
        });
        console.log(``);
        console.log(`Please validate your changes locally. Make sure that you build packages using an NPM version lower than 7`);
        console.log(``);

        process.exit(1);
    };

    console.log(`No uncommitted changes found`);
    console.log(``);
});
