import * as assert from 'assert';
import * as httpm from 'typed-rest-client/HttpClient';

import * as models from '../Models';
import * as providers from '../Providers';

var sinon = require('sinon');

var artifactItem: models.ArtifactItem;
var zipProvider: providers.ZipProvider;
var getStub;
var stubResponse;

beforeEach((done) => {
    var handler = sinon.spy();
    zipProvider = new providers.ZipProvider('', handler);

    stubResponse = new httpm.HttpClientResponse(null);
    stubResponse.message = { on: (a, b) => { } };
    getStub = sinon.stub(zipProvider.webClient, 'get').returns(new Promise<httpm.HttpClientResponse>((resolve) => {
        resolve(stubResponse);
    }));

    artifactItem = {
        fileLength: 0,
        itemType: models.ItemType.File,
        path: 'path1\\file1',
        lastModified: null,
        contentType: undefined,
        metadata: { 'downloadUrl': 'http://stubUrl' }
    };

    done();
});

describe('Unit Tests', () => {
    describe('zipProvider tests', () => {
        it('getArtifactItems should reject as not implemented', (done) => {
            zipProvider.getArtifactItems(artifactItem).then(() => {
                done(new Error('Expected getArtifactItems to reject'));
            }, (err) => {
                try {
                    assert.strictEqual(err.message, 'Not implemented');
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it('getArtifactItem should call http get with correct url', (done) => {
            zipProvider.getArtifactItem(artifactItem).then(() => {
                assert.strictEqual(getStub.callCount, 1);
                assert.strictEqual(getStub.args[0][0], 'http://stubUrl');
                done();
            }, (err) => {
                throw err;
            });
        });

        it('getArtifactItem should reject when download url is unavailable', (done) => {
            artifactItem.metadata = null;

            zipProvider.getArtifactItem(artifactItem).then(() => {
                done(new Error('Expected getArtifactItem to reject'));
            }, (err) => {
                try {
                    assert.strictEqual(err, 'No downloadUrl available to download the item.');
                    assert.strictEqual(getStub.callCount, 0);
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });
    });
});