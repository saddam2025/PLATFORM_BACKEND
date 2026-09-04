const mongoose = require('mongoose');
const readline = require('readline');
const path = require('path');

// Load environment variables from the backend .env
require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
});

const User = require('../src/models/User');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function hiddenQuestion(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    let password = '';

    const onData = (char) => {
      char = char.toString();

      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
        return;
      }

      if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      }

      if (char === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
        }
        return;
      }

      password += char;
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function createSuperAdmin() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI غير موجود في ملف .env');
    }

    console.log('\n=== إنشاء حساب Super Admin ===\n');

    const name = (await question('الاسم: ')).trim();
    const email = (await question('البريد الإلكتروني: ')).trim().toLowerCase();
    const password = await hiddenQuestion('كلمة المرور: ');

    if (!name || !email || !password) {
      throw new Error('كل البيانات مطلوبة');
    }

    if (password.length < 8) {
      throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    }

    await mongoose.connect(process.env.MONGO_URI);

    console.log('\nتم الاتصال بقاعدة البيانات.');

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      throw new Error(
        `يوجد حساب بالفعل بهذا البريد الإلكتروني ودوره: ${existingUser.role}`
      );
    }

    const user = new User({
      name,
      email,
      passwordHash: password,
      role: 'super_admin',
      tenantId: null,
      stage: null,
      instructorId: null,
      permissions: [],
      inviteStatus: 'active',
      isActive: true
    });

    await user.save();

    console.log('\nتم إنشاء حساب Super Admin بنجاح.');
    console.log(`الاسم: ${user.name}`);
    console.log(`البريد الإلكتروني: ${user.email}`);
    console.log(`الدور: ${user.role}`);
    console.log(`ID: ${user._id}`);
    console.log('\nيمكنك الآن تسجيل الدخول من صفحة تسجيل الدخول.\n');
  } catch (error) {
    console.error('\nفشل إنشاء الحساب:');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    rl.close();

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

createSuperAdmin();