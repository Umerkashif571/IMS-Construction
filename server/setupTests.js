const { Pool } = require('pg');
const { createSchema } = require('./src/db/schema');

const TEST_DB = process.env.TEST_DATABASE_URL;

let testPool;

if (TEST_DB) {
  beforeAll(async () => {
    testPool = new Pool({ connectionString: TEST_DB, max: 5 });
    await createSchema(testPool);
  });

  afterAll(async () => {
    await testPool.end();
  });
}

module.exports = { testPool };