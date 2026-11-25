import * as assert from 'assert';
import * as Stream from 'stream';

import * as engine from '../Engine';
import * as models from '../Models';
import { ArtifactItemStore } from '../Store/artifactItemStore';

class HighVolumeSourceProvider implements models.IArtifactProvider {
    private readonly items: models.ArtifactItem[];
    public artifactItemStore: ArtifactItemStore;

    constructor(itemCount: number) {
        this.items = Array.from({ length: itemCount }, (_, i) => {
            const item = new models.ArtifactItem();
            item.path = `drop/folder/file-${i}.txt`;
            item.fileLength = 1;
            item.itemType = models.ItemType.File;
            item.metadata = {};
            return item;
        });
    }

    async getRootItems(): Promise<models.ArtifactItem[]> {
        return this.items;
    }

    async getArtifactItems(): Promise<models.ArtifactItem[]> {
        return [];
    }

    async getArtifactItem(artifactItem: models.ArtifactItem): Promise<NodeJS.ReadableStream> {
        const stream = new Stream.Readable();
        stream._read = () => { };
        stream.push(`content:${artifactItem.path}`);
        stream.push(null);
        return stream;
    }

    putArtifactItem(): Promise<models.ArtifactItem> {
        throw new Error('Source provider should not be used as destination.');
    }

    dispose(): void {
    }
}

class InMemoryDestinationProvider implements models.IArtifactProvider {
    public uploaded: { [itemPath: string]: string } = {};
    public artifactItemStore: ArtifactItemStore;

    async getRootItems(): Promise<models.ArtifactItem[]> {
        return [];
    }

    async getArtifactItems(): Promise<models.ArtifactItem[]> {
        return [];
    }

    async getArtifactItem(): Promise<NodeJS.ReadableStream> {
        throw new Error('Destination provider should not be used as source.');
    }

    async putArtifactItem(item: models.ArtifactItem, readStream: NodeJS.ReadableStream): Promise<models.ArtifactItem> {
        let data = '';

        await new Promise<void>((resolve, reject) => {
            readStream.on('data', (chunk) => {
                data += chunk;
            });
            readStream.on('end', () => resolve());
            readStream.on('error', (err) => reject(err));
        });

        this.uploaded[item.path] = data;
        return item;
    }

    dispose(): void {
    }
}

describe('Unit Tests', () => {
    describe('scalability tests', () => {
        it('processItems should handle high-volume file lists without failures', async function () {
            this.timeout(30000);

            const itemCount = 300;
            const processor = new engine.ArtifactEngine();
            const sourceProvider = new HighVolumeSourceProvider(itemCount);
            const destinationProvider = new InMemoryDestinationProvider();
            const processorOptions = new engine.ArtifactEngineOptions();
            processorOptions.itemPattern = '**';
            processorOptions.parallelProcessingLimit = 16;
            processorOptions.retryLimit = 1;
            processorOptions.verbose = false;

            const tickets = await processor.processItems(sourceProvider, destinationProvider, processorOptions);

            assert.strictEqual(tickets.length, itemCount);
            assert.strictEqual(Object.keys(destinationProvider.uploaded).length, itemCount);
            assert.strictEqual(tickets.filter(t => t.state === models.TicketState.Failed).length, 0);
        });
    });
});