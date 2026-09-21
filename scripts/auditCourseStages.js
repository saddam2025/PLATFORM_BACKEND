require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Course = require('../src/models/Course');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  const courses = await Course.find({}).select('_id title_ar title_en stage instructorId tenantId isPublished').sort({ createdAt: 1 }).lean();
  console.log(JSON.stringify(courses, null, 2));
  console.log(`TOTAL_COURSES=${courses.length}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  if (mongoose.connection.readyState) await mongoose.disconnect();
  process.exitCode = 1;
});
