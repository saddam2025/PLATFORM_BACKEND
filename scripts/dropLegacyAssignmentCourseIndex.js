const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const LEGACY_INDEX = 'tenantId_1_studentId_1_courseId_1';

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.collection('assignments');
  const indexes = await collection.indexes();

  if (!indexes.some((index) => index.name === LEGACY_INDEX)) {
    console.log(`Index ${LEGACY_INDEX} is already absent.`);
    return;
  }

  await collection.dropIndex(LEGACY_INDEX);
  console.log(`Dropped legacy index ${LEGACY_INDEX}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
