const IDLE_LIMIT_MS = 10 * 60 * 1000;

// Logs out any authenticated session that's been idle for longer than IDLE_LIMIT_MS
const idleTimeout = (req, res, next) => {
  if (!req.session.user) return next();

  const now = Date.now();
  if (req.session.lastActivity && now - req.session.lastActivity > IDLE_LIMIT_MS) {
    return req.session.destroy(() => res.redirect('/?expired=1'));
  }

  req.session.lastActivity = now;
  next();
};

module.exports = idleTimeout;
