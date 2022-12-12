const dirname = __dirname;
const path = require('path');

module.exports = {
    "reporterEnabled": "spec, mocha-junit-reporter",
    "mochaJunitReporterReporterOptions": {
        "mochaFile": `${dirname}${path.sep}junit/[hash]-unittest.xml`
    }
}
