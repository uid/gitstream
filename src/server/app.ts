// External Imports
import express from 'express';
import session from 'cookie-session';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { setupAuth } from './auth.js'

// Internal Files
import settings from '../../settings.js'
import * as routesUtils from './routesUtils.js';

export const app = express();
export const PORT = 4242; // for WebSocket connection

// set up a session cookie to hold the user's identity after authentication
const sessionParser = session({
    secret: settings.sessionSecret || crypto.pseudoRandomBytes(16).toString('hex'),
    sameSite: 'lax',
    signed: true,
    overwrite: true,
});

app.use(sessionParser);

// Extend the Express Request to include the user property and the session from cookie-session
interface AuthenticatedRequest extends Request {
    user: {
        username: string,
        fullname: string
    };
    session: {
        guest_user: {
            username: string,
            fullname: string
        },
        returnTo: string
    }
}

// this middleware sets req.user to an object { username:string, fullname:string }, either from
// session cookie information or by authenticating the user using the authentication method selected in settings.js.
//
// By default there is no authentication method, so this method authenticates as a guest user with a randomly-generated username.
let setUser = function(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.user) {
        if (req.session.guest_user){
            req.user = req.session.guest_user;
        } else {
            req.user = req.session.guest_user = {
                username: routesUtils.createRandomId(),
                fullname: "Guest User"
            };
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
        await setupAuth(app);
        
        setUser = function(req, res, next) {
            console.log('OpenID authenticated as', req.user);
            next();
        }
        
        setUserAuthenticateIfNecessary = function(req, res, next) {
            if ( ! req.user ) {
                req.session.returnTo = req.originalUrl;
                return res.redirect('/auth');
            }
            console.log('OpenID authenticated as', req.user);
            next();
        }

        console.log('openid auth is ready');
    }

    app.use( '/login', <any>setUserAuthenticateIfNecessary, function( req, res ) { // todo: any
        res.redirect(req.originalUrl.replace(/^\/login/, '/'));
    })

    app.use( '/user', <any>setUser, <any>function( req: AuthenticatedRequest, res: Response ) { // todo: fix any
        const userId = ( req.user && req.user.username ) || "";
        res.writeHead( 200, { 'Content-Type': 'text/plain' } )
        res.end( userId )
    });    
}

configureApp().catch(err => console.error(err));

export const server = app.listen(PORT)