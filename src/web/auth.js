export function setupAuth(app, config) {
  app.get('/auth/login', (req, res) => {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
    const params = new URLSearchParams({
      client_id: config.slackClientId,
      user_scope: 'identity.basic,identity.avatar',
      redirect_uri: redirectUri,
    });
    res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;

    try {
      const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.slackClientId,
          client_secret: config.slackClientSecret,
          code,
          redirect_uri: redirectUri,
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

