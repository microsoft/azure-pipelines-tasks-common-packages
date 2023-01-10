var path = require('path');
var process = require("process");
var util = require('./ci-util');

packagesList = util.getDirectories(util.commonPackagesSourcePath);

var totalDiffList = [];

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
            totalDiffList.push(item);
            console.log(` - ${item}`);
            console.log(``);
        });
    } else {
        console.log(``);
        console.log(`No uncommitted changes found`);
        console.log(``);
    };
});

if (totalDiffList.length) {
    console.log(``);
    console.log(`Please build packages locally and commit specified changes:`);
    console.log(``);

    totalDiffList.forEach(function(item){
        console.log(` - ${item}`);
    });

    console.log(``);
    console.log(`Make sure you are using Node 10 and NPM 6.`);
    console.log(``);

    process.exit(1);
};
