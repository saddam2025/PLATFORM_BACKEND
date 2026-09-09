require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const connectDB = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');

connectDB();

const app = express();

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

// Upload assets are rendered by the separately-hosted frontend in development.
// Helmet's default Cross-Origin-Resource-Policy is `same-origin`; override it
// only for the public upload tree, rather than weakening it application-wide.
// This route contains the avatar, thumbnail, and other explicit upload files
// and never exposes the project root.
app.use('/uploads', (req, res, next) => {
  // Course and lecture videos are never public static assets. They are served
  // through the lecture access controller, which verifies entitlement for
  // every content/range request.
  if (req.path.startsWith('/videos/')) return res.status(404).end();
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Upload middleware writes only to src/uploads/{avatars,videos,thumbnails,homework}.
// Expose that directory at the URL prefix stored by the corresponding models;
// never expose the project root itself.

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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});
