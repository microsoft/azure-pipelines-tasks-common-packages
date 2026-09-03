import * as assert from "assert";

export function runValidateDatabaseNameTests(): void {
    it("Should accept typical alphanumeric database names", async () => {
        const utility = await import('../utility');
        assert.strictEqual(utility.isValidDatabaseName('my_database-1'), true);
        assert.strictEqual(utility.isValidDatabaseName('$special_db'), true);
    });

    it("Should accept non-ASCII BMP characters", async () => {
        const utility = await import('../utility');
        assert.strictEqual(utility.isValidDatabaseName('数据库'), true);
        assert.strictEqual(utility.isValidDatabaseName('database_€'), true);
    });

    it("Should reject supplementary-plane characters such as emoji", async () => {
        const utility = await import('../utility');
        assert.strictEqual(utility.isValidDatabaseName('db_😀'), false);
    });

    it("Should reject names containing shell-sensitive characters", async () => {
        const utility = await import('../utility');
        assert.strictEqual(utility.isValidDatabaseName('db; DROP TABLE users;'), false);
        assert.strictEqual(utility.isValidDatabaseName('db`whoami`'), false);
        assert.strictEqual(utility.isValidDatabaseName('db && echo pwned'), false);
    });

    it("Should reject an empty database name", async () => {
        const utility = await import('../utility');
        assert.strictEqual(utility.isValidDatabaseName(''), false);
    });
}
