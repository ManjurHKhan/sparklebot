import { requireAuth } from './auth.js';

function buildCommonLocals(req, config, overrides = {}) {
  const currency = config.currency || 'sparkle';
  return {
    user: req.session?.user || null,
    colorPrimary: config.colorPrimary,
    colorAccent: config.colorAccent,
    emoji: config.emoji,
    appName: currency.charAt(0).toUpperCase() + currency.slice(1) + 'bot',
    currencyPlural: config.currencyPlural,
    ...overrides,
  };
}

export function setupRoutes(app, db, config) {
  // Root redirect
  app.get('/', (req, res) => {
    res.redirect('/leaderboard');
  });

  // Leaderboard
  app.get('/leaderboard', (req, res) => {
    const board = db.getLeaderboard(10);
    res.render('leaderboard', buildCommonLocals(req, config, {
      title: 'Leaderboard',
      currentPage: 'leaderboard',
      board,
    }));
  });

  // Activity feed
  app.get('/feed', (req, res) => {
    const activity = db.getRecentActivity(50);
    res.render('feed', buildCommonLocals(req, config, {
      title: 'Activity',
      currentPage: 'feed',
      activity,
    }));
  });

  // HTMX partial: new feed items since a given sparkle ID
  app.get('/feed/new', (req, res) => {
    const after = parseInt(req.query.after || '0', 10);
    const all = db.getRecentActivity(50);
    const items = all.filter(i => i.id > after);
    if (items.length === 0) return res.send('');
    res.render('partials/sparkle-list', { items });
  });

  // Channels
  app.get('/channels', (req, res) => {
    const stats = db.getChannelStats();
    res.render('channels', buildCommonLocals(req, config, {
      title: 'Channels',
      currentPage: 'channels',
      stats,
    }));
  });

  // My sparkles (protected)
  app.get('/me', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const rankData = db.getUserRank(userId);
    const totalReceived = db.getTotalReceived(userId);
    const totalGiven = db.getTotalGiven(userId);
    const received = db.getSparklesReceived(userId, 50);

    res.render('history', buildCommonLocals(req, config, {
      title: 'My Sparkles',
      currentPage: 'me',
      rank: rankData?.rank || null,
      totalReceived,
      totalGiven,
      received,
    }));
  });

  // HTMX partial: received sparkles for current user
  app.get('/me/received', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const items = db.getSparklesReceived(userId, 50);
    if (items.length === 0) {
      return res.send('<div class="card empty-state"><p>No sparkles received yet. They\'re coming! ✨</p></div>');
    }
    res.render('partials/sparkle-list', { items });
  });

  // HTMX partial: given sparkles for current user
  app.get('/me/given', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const items = db.getSparklesGiven(userId, 50);
    if (items.length === 0) {
      return res.send('<div class="card empty-state"><p>No sparkles given yet. Start recognizing your teammates! ✨</p></div>');
    }
    res.render('partials/sparkle-list', { items });
  });

  // Error page
  app.get('/error', (req, res) => {
    const currency = config.currency || 'sparkle';
    res.render('error', {
      title: 'Error',
      appName: currency.charAt(0).toUpperCase() + currency.slice(1) + 'bot',
      colorPrimary: config.colorPrimary,
      colorAccent: config.colorAccent,
      message: req.query.message || 'An unexpected error occurred. Please try again.',
    });
  });
}
