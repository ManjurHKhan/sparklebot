import crypto from 'crypto';

export function setupAuth(app, config) {
  app.get('/auth/login', (req, res) => {
    // Generate CSRF state token
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const params = new URLSearchParams({
      client_id: config.slackClientId,
      user_scope: 'identity.basic,identity.avatar',
      redirect_uri: config.oauthRedirectUri,
      state,
    });
    res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;

    // Verify CSRF state token
    if (!state || state !== req.session.oauthState) {
      req.session.oauthState = null;
      return res.redirect('/error?message=Invalid session. Please try again.');
    }
    req.session.oauthState = null;

    if (!code) {
      return res.redirect('/error?message=Authentication failed. Please try again.');
    }

    try {
      const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.slackClientId,
          client_secret: config.slackClientSecret,
          code,
          redirect_uri: config.oauthRedirectUri,
        }),
      });

      const tokenData = await tokenRes.json();

      if (!tokenData.ok) {
        return res.redirect('/error?message=Authentication failed. Please try again.');
      }

      const accessToken = tokenData.authed_user?.access_token;

      if (!accessToken) {
        return res.redirect('/error?message=Authentication failed. Please try again.');
      }

      const identityRes = await fetch('https://slack.com/api/users.identity', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const identityData = await identityRes.json();

      if (!identityData.ok) {
        return res.redirect('/error?message=Authentication failed. Please try again.');
      }

      req.session.user = {
        id: identityData.user.id,
        name: identityData.user.name,
        avatar: identityData.user.image_48,
      };

      res.redirect('/');
    } catch {
      res.redirect('/error?message=Authentication failed. Please try again.');
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
  });
}

export function requireAuth(req, res, next) {
  if (req.session?.user) {
    return next();
  }
  res.redirect('/auth/login');
}
