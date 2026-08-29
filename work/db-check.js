require('dotenv').config();
console.log('START');
const mongoose = require('mongoose');
const Course = require('../src/models/Course');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(JSON.stringify({
    a: await Course.countDocuments({ tenantId: '6a9222357ac23b5f93a2f7a2' }),
    b: await Course.countDocuments({ tenantId: '6a9222367ac23b5f93a2f7a4' })
  }));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
