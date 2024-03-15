// All things related to configuring the auth route (sessions, openid authentication, route handlers)

// External Imports
import { Passport } from 'passport';
import openidclient from 'openid-client';
import { TokenSet, UserinfoResponse } from 'openid-client';
import { Application } from 'express';

// Internal Files
import settings from '../../settings.js'

export async function setupAuth(app: Application){
  const passport = new Passport();
  const openidissuer = await openidclient.Issuer.discover(settings.openid.serverUrl);
  const client = new openidissuer.Client({
      client_id: settings.openid.clientId,
      client_secret: settings.openid.clientSecret,
      redirect_uris: [ settings.openid.clientUrl + (settings.openid.clientUrl.endsWith('/') ? '' : '/') + 'auth' ]
  });

  // https://github.com/panva/node-openid-client/blob/master/docs/README.md#customizing-clock-skew-tolerance
  client[(openidclient.custom).clock_tolerance] = 'clockTolerance' in settings.openid ? settings.openid.clockTolerance : 5;

  const usernameFromEmail = settings.openid.usernameFromEmail || ((email: string) => email);

  // todo: this use can be moved out/above
  const OpenIdStrategy = "openid";
  passport.use(OpenIdStrategy, new openidclient.Strategy({
      client,
      params: { scope: 'openid email profile' },
  }, (tokenset: TokenSet, passportUserInfo: UserinfoResponse, done: any) => { // todo: any
      console.log('passport returned', passportUserInfo);
      const username = usernameFromEmail(passportUserInfo.email || '');
      const fullname = passportUserInfo.name || '';
      done(null, { username, fullname });
  }));


  const returnUserInfo = (userinfo: any, done: any) => done(null, userinfo);
  passport.serializeUser(returnUserInfo);
  passport.deserializeUser(returnUserInfo);

  const passportInit = passport.initialize();
  app.use(passportInit);

  const passportSession = passport.session();
  app.use(passportSession);

  app.use('/auth', (req, res, next) => {
      passport.authenticate(OpenIdStrategy,
          // see "Custom Callback" at http://www.passportjs.org/docs/authenticate/
          (err: Error, user: any, info: any) => { // todo: any
              if (err || !user) {
                  // put some debugging info in the log
                  console.log('problem in OpenId authentication', req.originalUrl);
                  console.log('error', err);
                  console.log('user', user);
                  console.log('info', info);
              }

              if (err) { return next(err); }
              if (!user) {
                  // unsuccessful authentication
                  return res.status(401).send('Unauthorized: ' + info);
              } else {
                  // successful authentication, log the user in
                  // http://www.passportjs.org/docs/login/
                  req.login(user, (err) => {
                      if (err) { return next(err); }
                      return res.redirect(req.session!.returnTo); // assert
                  });
              }
          }
      )(req, res, next);
  });
}