
import { PrismaClient } from '../../generated/prisma/index.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing. Check .env.test.');
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');

if (databaseName !== 'pickup_counter_test') {
  throw new Error(
    `Refusing to run integration tests against "${databaseName}". ` +
      'Expected "pickup_counter_test".',
  );
}

export const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseUrl },
  },
});
