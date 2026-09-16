require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./src/models/User');

const EMAIL = 'mrattiakamel@gmail.com';
const CANDIDATE_PASSWORD = 'MrAttiaKamel12344321';

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const user = await User.findOne({ email: EMAIL }).select('+passwordHash');

    if (!user) {
      console.log('❌ مفيش حساب بالإيميل ده');
      return;
    }

    console.log('✅ الحساب موجود');
    console.log('Email:', user.email);
    console.log('Hash length:', user.passwordHash?.length);

    const isMatch = await bcrypt.compare(
      CANDIDATE_PASSWORD,
      user.passwordHash
    );

    console.log(
      'نتيجة المقارنة:',
      isMatch ? '✅ الباسورد مطابق' : '❌ الباسورد مش مطابق'
    );
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
})();