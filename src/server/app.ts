import express from 'express';
import session from 'cookie-session';
import { Request, Response, NextFunction } from 'express';
import { Passport } from 'passport';
import openidclient from 'openid-client';
import { Strategy as OpenIdClientStrategy, TokenSet, UserinfoResponse } from 'openid-client';
import crypto from 'crypto';

import settings from '../../settings.js'

export const app = express();

const PORT = 4242; 
const GS_ROUTE = '/gitstream';

// set up a session cookie to hold the user's identity after authentication
const sessionParser = session({
    secret: settings.sessionSecret || crypto.pseudoRandomBytes(16).toString('hex'),
    sameSite: 'lax',
    signed: true,
    overwrite: true,
});

// Apply the sessionParser only to /gitstream route
app.use(GS_ROUTE, sessionParser);

// Extend the Express Request to include the user property and the session from cookie-session
interface AuthenticatedRequest extends Request {
    user?: {
        username: string,
        fullname: string
    };
    session?: any //todo: any
}
  

/**
 * Generates a random 5 character ID string prefixed with 'user'
 */
function createRandomId(): string {
    return 'user' + crypto.pseudoRandomBytes(3).toString('hex').substring(0, 5)
}

// this middleware sets req.user to an object { username:string, fullname:string }, either from
// session cookie information or by authenticating the user using the authentication method selected in settings.js.
//
// By default there is no authentication method, so this method authenticates as a guest user with a randomly-generated username.
let setUser = function(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if ( !req.user ) {
        if (req.session.guest_user){
            req.user = req.session.guest_user;
        } else {
            req.user = req.session.guest_user = { username: createRandomId(), fullname: "Guest User" }
        }
    }
    console.log('guest user connected as', req.user);
    next();
};

let setUserAuthenticateIfNecessary = setUser; 

async function configureApp() {
    // if we have settings for OpenID authentication, configure it
    // this should always be the case, unless you're debugging and want to generate random
    // usernames per session


    if (settings.openid) {
        const passport = new Passport();
        const openidissuer = await openidclient.Issuer.discover(settings.openid.serverUrl);
        const client = new openidissuer.Client({
            client_id: settings.openid.clientId,
            client_secret: settings.openid.clientSecret,
            redirect_uris: [ settings.openid.clientUrl + (settings.openid.clientUrl.endsWith('/') ? '' : '/') + 'auth' ] // todo: what should be done here?
        });

        // https://github.com/panva/node-openid-client/blob/master/docs/README.md#customizing-clock-skew-tolerance
        client[(openidclient.custom).clock_tolerance] = 'clockTolerance' in settings.openid ? settings.openid.clockTolerance : 5;
        
        const usernameFromEmail = settings.openid.usernameFromEmail || ((email: string) => email);
        
        passport.use('openid', new openidclient.Strategy({
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
        
        app.use(GS_ROUTE + '/auth',
                (req, res, next) => {
                    passport.authenticate(
                        'openid',
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
                    ) (req, res, next);
                }
        );
        
        setUser = function(req, res, next) {
            console.log('OpenID authenticated as', req.user);
            next();
        }
        
        setUserAuthenticateIfNecessary = function(req, res, next) {
            if ( ! req.user ) {
                req.session.returnTo = req.originalUrl;
                return res.redirect(GS_ROUTE + '/auth');
            }
            console.log('OpenID authenticated as', req.user);
            next();
        }

        app.use(GS_ROUTE + '/login', <any>setUserAuthenticateIfNecessary, function( req, res ) { // todo: any
            res.redirect(req.originalUrl.replace(new RegExp(`^${GS_ROUTE}/login`), GS_ROUTE));
        })

        app.use(GS_ROUTE + '/user', <any>setUser, <any>function( req: AuthenticatedRequest, res: Response ) { // todo: fix any
            const userId = ( req.user && req.user.username ) || "";
            res.writeHead( 200, { 'Content-Type': 'text/plain' } )
            res.end( userId )
        });

        console.log('openid auth is ready');
    }
}
configureApp().catch(err => console.error(err));

export const server = app.listen(PORT)
