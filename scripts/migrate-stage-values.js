require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Course = require('../src/models/Course');
const { STAGE_ENUM } = require('../src/constants/stages');

// The audit found no legacy Arabic values. Unknown values are deliberately
// reported and left untouched instead of being assigned by a guessed alias.
const STAGE_MAPPING = Object.fromEntries(STAGE_ENUM.map((stage) => [stage, stage]));

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  const courses = await Course.find({}).select('_id title_ar stage').sort({ _id: 1 }).lean();
  let changed = 0;
  let unsupported = 0;
  for (const course of courses) {
    const nextStage = STAGE_MAPPING[course.stage];
    if (!nextStage) {
      unsupported += 1;
      console.log(`[UNSUPPORTED] ${course._id} | ${course.title_ar} | ${JSON.stringify(course.stage)} | no automatic mapping applied`);
      continue;
    }
    if (nextStage === course.stage) {
      console.log(`[UNCHANGED] ${course._id} | ${course.title_ar} | ${course.stage}`);
      continue;
    }
    await Course.updateOne({ _id: course._id }, { $set: { stage: nextStage } });
    changed += 1;
    console.log(`[UPDATED] ${course._id} | ${course.title_ar} | ${course.stage} -> ${nextStage}`);
  }
  console.log(`SUMMARY total=${courses.length} changed=${changed} unsupported=${unsupported}`);
  await mongoose.disconnect();
  if (unsupported) process.exitCode = 2;
}

main().catch(async (error) => {
  console.error(error.message);
  if (mongoose.connection.readyState) await mongoose.disconnect();
  process.exitCode = 1;
});
