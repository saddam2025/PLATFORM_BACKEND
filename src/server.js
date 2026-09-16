require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
app.set('trust proxy', 1);

// Security headers (OWASP A05 — Security Misconfiguration).
app.use(helmet());

// CORS is restricted to the configured, comma-separated frontend origins —
// never wildcard, because credentialed requests require an explicit origin.
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients omit Origin; browser requests must match the
      // explicitly configured allow-list.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Rate limiting on auth routes only — blunts credential-stuffing / brute
// force attempts against login/register (OWASP A07 — Identification and
// Authentication Failures) without throttling the rest of the API.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});
app.use('/api/v1/auth', authLimiter);

// A six-digit TOTP is much smaller than a password search space. This stricter
// per-IP cap complements the general auth limiter; it is role-neutral so it
// does not disclose or depend on the privilege of the pending account.
const mfaVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many MFA verification attempts, please try again later.' }
});
app.use('/api/v1/auth/mfa/verify-login', mfaVerifyLimiter);

// ROUTES MOUNTED HERE
app.use('/api/v1/instructors', require('./routes/courseRoutes'));
app.use('/api/v1', require('./routes/lectureRoutes'));
app.use('/api/v1/public', require('./routes/publicContentRoutes'));
const { quizRoutes, quizAuthoringRoutes } = require('./routes/quizRoutes');
app.use('/api/v1/quizzes', quizRoutes);
app.use('/api/v1/instructors', quizAuthoringRoutes);
app.use('/api/v1/subscriptions', require('./routes/subscriptionRoutes'));
app.use('/api/v1/courses', require('./routes/lectureAccessRoutes'));
app.use('/api/v1/instructors', require('./routes/studentProfileRoutes'));
app.use('/api/v1/instructors', require('./routes/exportRoutes'));
app.use('/api/v1', require('./routes/reelRoutes')); // reelRoutes defines its own /instructors/... and /reels/... prefixes internally
app.use('/api/v1/notifications', require('./routes/notificationRoutes'));
app.use('/api/v1/instructors', require('./routes/leaderboardRoutes'));
app.use('/api/v1/messages', require('./routes/messageRoutes'));
app.use('/api/v1/parents', require('./routes/parentRoutes'));
app.use('/api/v1', require('./routes/scratchCardRoutes'));
app.use('/api/v1', require('./routes/accessCodeRoutes'));
app.use('/api/v1', require('./routes/paymentRoutes'));
app.use('/api/v1', require('./routes/assignmentRoutes'));
app.use('/api/v1', require('./routes/standaloneExamRoutes'));
// (future prompts will add: app.use('/api/v1/auth', authRoutes); etc.)
app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/instructors', require('./routes/userRoutes'));
app.use('/api/v1/instructors', require('./routes/tenantSettingsRoutes'));
app.use('/api/v1/instructors', require('./routes/dashboardRoutes'));
app.use('/api/v1/super-admin', require('./routes/superAdminRoutes'));
app.use('/api/v1/tenants', require('./routes/publicTenantRoutes'));
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

// Centralized error handler — MUST be last.
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Do not accept requests until MongoDB is connected. Starting the HTTP server
// first makes a failed or slow database connection look like a working API
// and turns authentication failures into misleading client-side errors.
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });
}

startServer();
