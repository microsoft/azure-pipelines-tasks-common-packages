import * as assert from 'assert';
import { Worker } from '../Engine/worker';

describe('Unit Tests', () => {
    describe('worker tests', () => {
        it('init should resolve when download has already failed', (done) => {
            var executeCallCount = 0;
            var execute = (_item) => {
                executeCallCount++;
                return Promise.resolve();
            };

            var worker = new Worker<number>(1, execute, () => null, () => false, () => true);

            worker.init().then(() => {
                assert.strictEqual(executeCallCount, 0);
                done();
            }, (err) => {
                done(err);
            });
        });
    });
});