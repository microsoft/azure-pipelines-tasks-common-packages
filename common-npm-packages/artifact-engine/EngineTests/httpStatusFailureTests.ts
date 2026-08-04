import * as assert from 'assert';
import * as path from 'path';

import * as engine from '../Engine';
import * as providers from '../Providers';

import { PersonalAccessTokenCredentialHandler } from 'typed-rest-client/handlers/personalaccesstoken';

const nock = require('nock');

describe('Unit Tests', () => {
    describe('HTTP status failure scenarios', () => {
        beforeEach(() => {
            nock.cleanAll();
        });

        it('should fail download if get artifact items returns 404', function (done) {
            this.timeout(10000);

            nock('https://httpbin.org')
                .persist()
                .get('/status/404')
                .reply(404);

            const processor = new engine.ArtifactEngine();

            const processorOptions = new engine.ArtifactEngineOptions();
            processorOptions.itemPattern = '**';
            processorOptions.retryLimit = 2;
            processorOptions.retryIntervalInSeconds = 1;
            processorOptions.verbose = true;

            const handler = new PersonalAccessTokenCredentialHandler('dummyPat');
            const webProvider = new providers.WebProvider('https://httpbin.org/status/404', 'vsts.handlebars', {}, handler, { ignoreSslError: false });
            const filesystemProvider = new providers.FilesystemProvider(path.join('dummydroplocation', 'vstsDropWithMultipleFiles'));

            processor.processItems(webProvider, filesystemProvider, processorOptions)
                .then(() => assert.fail('Expected failure'), (error) => {
                    assert.strictEqual(error.statusCode, 404);
                    done();
                });
        });

        it('should fail download if get artifact items returns 401', function (done) {
            this.timeout(10000);

            nock('https://httpbin.org')
                .persist()
                .get('/status/401')
                .reply(401);

            const processor = new engine.ArtifactEngine();
            const processorOptions = new engine.ArtifactEngineOptions();
            processorOptions.retryLimit = 1;
            processorOptions.verbose = true;

            const handler = new PersonalAccessTokenCredentialHandler('dummyPat');
            const webProvider = new providers.WebProvider('https://httpbin.org/status/401', 'vsts.handlebars', {}, handler, { ignoreSslError: false });
            const filesystemProvider = new providers.FilesystemProvider(path.join('dummydroplocation', 'vstsDropWithMultipleFiles'));

            processor.processItems(webProvider, filesystemProvider, processorOptions)
                .then(() => assert.fail('Expected failure'), (error) => {
                    assert.strictEqual(error.statusCode, 401);
                    done();
                });
        });

        it('should fail download if get artifact items returns 500', function (done) {
            this.timeout(10000);

            nock('https://httpbin.org')
                .persist()
                .get('/status/500')
                .reply(500);

            const processor = new engine.ArtifactEngine();
            const processorOptions = new engine.ArtifactEngineOptions();
            processorOptions.retryLimit = 1;
            processorOptions.verbose = true;

            const handler = new PersonalAccessTokenCredentialHandler('dummyPat');
            const webProvider = new providers.WebProvider('https://httpbin.org/status/500', 'vsts.handlebars', {}, handler, { ignoreSslError: false });
            const filesystemProvider = new providers.FilesystemProvider(path.join('dummydroplocation', 'vstsDropWithMultipleFiles'));

            processor.processItems(webProvider, filesystemProvider, processorOptions)
                .then(() => assert.fail('Expected failure'), (error) => {
                    assert.strictEqual(error.statusCode, 500);
                    done();
                });
        });
    });
});