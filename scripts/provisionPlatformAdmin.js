const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const User = require('../src/models/User');
const Tenant = require('../src/models/Tenant');
const { PERMISSION_ENUM } = require('../src/models/User');

const [name, email, password, tenantName, subdomain] = process.argv.slice(2);
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

async function provisionPlatformAdmin() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  if (![name, email, password, tenantName, subdomain].every((value) => typeof value === 'string' && value.trim())) {
    throw new Error('Usage: node scripts/provisionPlatformAdmin.js <name> <email> <password> <tenant-name> <subdomain>');
  }
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedSubdomain = subdomain.trim().toLowerCase();
  if (!SUBDOMAIN_PATTERN.test(normalizedSubdomain)) throw new Error('Invalid subdomain');

  await mongoose.connect(process.env.MONGO_URI);
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    let admin = await User.findOne({ email: normalizedEmail }).session(session);
    let tenant;

    if (admin?.tenantId) {
      tenant = await Tenant.findById(admin.tenantId).session(session);
      if (!tenant) throw new Error('The existing account has an invalid tenant reference');
    } else {
      tenant = await Tenant.findOne({ subdomain: normalizedSubdomain }).session(session);
      if (tenant) throw new Error('The requested subdomain is already in use');
      [tenant] = await Tenant.create([{ name: tenantName.trim(), subdomain: normalizedSubdomain, subscriptionStatus: 'trial', isActive: true }], { session });
    }

    if (admin) {
      admin.name = name.trim();
      admin.passwordHash = password;
      admin.role = 'admin';
      admin.tenantId = tenant._id;
      admin.permissions = PERMISSION_ENUM;
      admin.isActive = true;
      admin.deletedAt = null;
      await admin.save({ session });
    } else {
      [admin] = await User.create([{
        name: name.trim(), email: normalizedEmail, passwordHash: password,
        role: 'admin', tenantId: tenant._id, permissions: PERMISSION_ENUM
      }], { session });
    }
    if (!tenant.ownerId) {
      tenant.ownerId = admin._id;
      await tenant.save({ session });
    }
    await session.commitTransaction();
    console.log(`Platform admin provisioned: ${admin.email} (${admin._id})`);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

provisionPlatformAdmin()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
