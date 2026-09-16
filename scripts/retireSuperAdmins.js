const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const User = require('../src/models/User');

async function retireSuperAdmins() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);

  // Preserve historical documents, but ensure no legacy platform-wide account
  // can authenticate after the role has been retired from application code.
  const result = await User.updateMany(
    { role: 'super_admin', isActive: { $ne: false } },
    { $set: { isActive: false, deletedAt: new Date() } }
  );
  console.log(`Retired ${result.modifiedCount} legacy super-admin account(s).`);
}

retireSuperAdmins()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
