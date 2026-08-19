const crypto  = require('crypto');
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');

const requestLogger = require('./middleware/requestLogger');
const flash = require('./middleware/flash');
const idleTimeout = require('./middleware/idleTimeout');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1);

// Security headers — CSP allows inline scripts/styles (required by EJS templates)
// but blocks objects, restricts base URI, and prevents framing
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-inline'"],
        styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:      ["'self'", 'data:', 'blob:'],
        connectSrc:  ["'self'"],
        objectSrc:      ["'none'"],
        baseUri:        ["'self'"],
        frameAncestors: ["'none'"],
        scriptSrcAttr:  ["'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS — only allow an explicit origin; no wildcard in production
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin, credentials: true } : { origin: false }));

app.use(compression());
app.use(
  rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false })
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/siicasem',
      touchAfter: 60, // re-persist at most once a minute, needed for idle-timeout tracking
      ttl: 24 * 60 * 60, // seconds; backstop cleanup, actual logout is enforced by idleTimeout
    }),
    cookie: {
      secure:   process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      // no maxAge: session cookie, cleared by the browser when the window/tab is closed
    },
  })
);

app.use(requestLogger);
app.use(flash);
app.use(idleTimeout);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/index'));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
