// Imported Libraries -- EXTERNAL
const compression = require('compression'),
    express = require('express'),
    path = require('path'),
    q = require('q'),
    rimraf = require('rimraf'),
    WebSocket = require('ws'),
    session = require('cookie-session'),
    { Passport } = require('passport'),
    openidclient = require('openid-client'),
    crypto = require('crypto'),
    EventEmitter = require('events'),
    { spawn } = require('child_process'),
    MongoClient = require('mongodb').MongoClient,
    mongodb = q.nfcall(MongoClient.connect, 'mongodb://localhost/gitstream')
        .then(client => client.db());
  
// Imported Libraries -- INTERNAL
const ExerciseMachine = require('./ExerciseMachine'),
    utils = require('./utils'),
    angler = require('git-angler'),
    exerciseConfs = require('gitstream-exercises'),
    settings = require('../../src/secrets/settings'),
    { WS_TYPE, ...logger } = require('./logger')({ dbcon: mongodb }), // LOGGING
    user = require('./user')({ dbcon: mongodb });

// Global variables -- CONSTANT
const PATH_TO_REPOS = '/srv/repos',
    PATH_TO_EXERCISES = __dirname + '/exercises/',
    PORT = 4242, // for WebSocket connection
    REPO_NAME_REGEX = /\/[a-z0-9_-]+\/[a-f0-9]{6,}\/.+.git$/,
    gitHTTPMount = '/repos'; // no trailing slash

const app = express();

const FIELD_EXERCISE_STATE = 'exerciseState',
    FIELD_CURRENT_EXERCISE = 'currentExercise'

const EVENTS = {
    sync: 'sync',
    exerciseDone: 'exerciseDone',
    exerciseChanged: 'exerciseChanged',
    step: 'step',
    halt: 'halt'
}

const EVENTS_ENDPOINT = '/events'; // configured with nginx


// Global Variables -- DYNAMIC
var eventBus = new angler.EventBus(), // todo: might constant, but leaving here for now
    githookEndpoint = angler.githookEndpoint({
        pathToRepos: PATH_TO_REPOS,
        eventBus: eventBus,
        gitHTTPMount: gitHTTPMount
    })

var backend = angler.gitHttpBackend({ // todo: might constant, but leaving here for now
    pathToRepos: PATH_TO_REPOS,
    eventBus: eventBus,
    authenticator: function( params, cb ) {
        verifyAndGetRepoInfo( params.repoPath )
        .done( function() {
            cb({ ok: true })
        }, function( err ) {
            var info = extractRepoInfoFromPath( params.repoPath )
            logger.err( logger.ERR.GIT_HTTP, info.userId, info.exerciseName, {
                msg: err.message
            })
            cb({ ok: false, status: 404 })
        })
    }
})

function logDbErr(userId, exercise, data) {
    return (err) => {
        if (!err) return
        data.msg = err.message
        console.error(err);
        logger.err(logger.ERR.DB, userId, exercise, data)
    }
}

const exerciseEvents = new EventEmitter();

/**
 * Global map to store user progress. Methods encapsulated.
 */
let userMap = {
    /**
     * @callback errorCallback
     * @param {Error?} err - An error object if the operation fails.
     * @returns {void} - This function does not return anything (mutator function).
     */

    /**
     * @callback standardCallback
     * @param {Error} err - An error object if the operation fails.
     * @param {Error} res - A result object if the operation succeeds.
     * @returns {void} - This function does not return anything (mutator function).
     */

    /**
     * Sets a key-value pair for a user. If the user and/or key does not exist, they are created.
     * 
     * @param {string} userID - The ID of the user.
     * @param {string} key - The key to be set or edited for the specified user.
     * @param {string} value - The value to be associated with the specified key. Overrides existing
     *                         value.
     * @param {errorCallback} callback - The optional callback to be invoked if the operation fails.
     * @returns {void} - This function does not return anything (mutator function).
     */
    set(userID, key, value, callback=null) {
        try {
          if (!this[userID])
            this[userID] = {};

          this[userID][key] = value;
          logger.userMapMod(this, userID, "set");

          if (callback)
            return callback(null);
        } catch (error) {
          if (callback)
            return callback(error);
        }
    },

    /**
     * Deletes a list of keys and their associated data for a user. If the user or one of 
     * the keys cannot be found, nothing happens.
     * 
     * @param {string} userID - The ID of the user.
     * @param {Array<string>} keys - The list of keys to be deleted along with their data.
     * @param {errorCallback} callback - The optional callback to be invoked if the operation fails.
     * @returns {void} - This function does not return anything (mutator function).
     */
    delete(userID, keys, callback=null) {
        try {
          const userInfo = this[userID];
          
          if (!userInfo) {
            if (callback)
              return callback(null);
            return
          }
          
          for (const key of keys) {
            if (key in userInfo) {
              delete userInfo[key];
              logger.userMapMod(this, userID, "delete");
            }
          }

          if (callback)
            return callback(null);
        } catch (error) {
          if (callback)
            return callback(error);
        }
    },

    /**
     * Retrieves all of the data (keys and values) associated with a user. If user is not
     * found, an empty object is returned.
     * 
     * @param {string} userID - The ID of the user.
     * @param {standardCallback} callback - The callback to be invoked on failure or success.
     * @returns {void} - This function does not return anything (mutator function)
     */
    getAll(userID, callback) {
        logger.userMapMod(this, userID, "getAll");

        try {
            const userInfo = this[userID];
            
            if (!userInfo) {
              return callback(null, {});
            }

            // Return a shallow copy of the userInfo object
            const userInfoCopy = Object.assign({}, userInfo);

            return callback(null, userInfoCopy);
        } catch (error) {
            return callback(error, null);
        }
    }
}

/**
 * Extracts data from the components of a repo's path
 * @param {String|Array} repoPath a path string or an array of path components
 * @return {Object|Boolean} data - if repo path is invalid, returns null
 *  { userId: String, exerciseName: String, mac: String, macMsg: String }
 */
function extractRepoInfoFromPath( repoPath ) {
    // slice(1) to remove the '' from splitting '/something'
    var splitRepoPath = repoPath instanceof Array ? repoPath : repoPath.split('/').slice(1),
        userId,
        repoMac,
        exerciseName,
        macMsg

    if ( splitRepoPath.length < 3) {
        return null
    }

    // e.g. /nhynes/12345/exercisename.git
    userId = splitRepoPath[0]
    repoMac = splitRepoPath[1]
    exerciseName = splitRepoPath[2].replace( /\.git$/, '' ),
    macMsg = userId + exerciseName

    return {
        userId: userId,
        mac: repoMac,
        exerciseName: exerciseName,
        macMsg: macMsg
    }
}

/** Does the inverse of @see extractRepoInfoFromPath. macMsg is not required */
function createRepoShortPath( info ) {
    return path.join( '/', info.userId, info.mac, info.exerciseName + '.git' )
}

/**
 * Verifies the MAC provided in a repo's path (ex. /username/beef42-exercise2.git)
 * @param {String|Array} repoPath a path string or an array of path components
 * @return {Promise}
 */
function verifyAndGetRepoInfo( repoPath ) {
    var repoInfo = extractRepoInfoFromPath( repoPath )

    if (!repoInfo) {
        throw Error('Could not get repo info')
    }

    return user.verifyMac( repoInfo.userId, repoInfo.mac, repoInfo.macMsg )
        .then(function() {
            return repoInfo
        })
}

/**
 * Creates a new exercise repo.
 * @param {String} repoName the full repo name. e.g. /nhynes/12345/exercise1.git
 * @return {Promise} a promise resolved with the repo info as returned by verifyAndGetRepoInfo
 */
function createRepo( repoName ) {
    var repoInfo,
        pathToRepo = path.join( PATH_TO_REPOS, repoName ),
        pathToRepoDir = path.dirname( pathToRepo ),
        pathToExercise,
        pathToStarterRepo

    return verifyAndGetRepoInfo( repoName )
    .then( function( info ) {
        repoInfo = info
        pathToExercise = path.join( PATH_TO_EXERCISES, repoInfo.exerciseName )
        pathToStarterRepo = path.join( pathToExercise, 'starting.git' )
        return q.nfcall( rimraf, pathToRepoDir )
    })
    .then( function() {
        var done = q.defer(),
            repoUtils = {
                _: require('lodash'),
                resourcesPath: pathToExercise
            },
            commits = q.promise( function( resolve ) {
                var commitsConf = exerciseConfs.repos[ repoInfo.exerciseName ]().commits
                if ( Array.isArray( commitsConf ) && commitsConf.length ) {
                    resolve( commitsConf )
                } else if ( typeof commitsConf === 'function' ) {
                    commitsConf.call( repoUtils, resolve )
                } else {
                    resolve()
                }
            }).catch( function( err ) { done.reject( err ) })

        utils.mkdirp( path.dirname( pathToRepo ) )
        .then( function() {
            spawn( 'cp', [ '-r', pathToStarterRepo, pathToRepo ] ).on( 'close', function( cpRet ) {
                if ( cpRet !== 0 ) { return done.reject( Error('Copying exercise repo failed') ) }

                commits.then( function( commits ) {
                    var addCommit = function( spec ) {
                        return utils.addCommit.bind( null, pathToRepo, pathToExercise, spec )
                    }
                    if ( commits ) {
                        return commits.map( function( commit ) {
                            return addCommit( commit )
                        }).reduce( q.when, q.fulfill() )
                    } else {
                        return utils.git( pathToRepo, 'commit', [ '-m', 'Initial commit' ] )
                    }
                })
                .done( function() {
                    done.resolve( repoInfo )
                }, function( err ) {
                    done.reject( err )
                })
            })
        })
        .catch( function( err ) { done.reject( err ) })
        .done() // TODO: make promises impl of cp-r

        return done.promise
    })
}

// transparently initialize exercise repos right before user clones it
eventBus.setHandler( '*', '404', function( repoName, _, data, clonable ) {
    if ( !REPO_NAME_REGEX.test( repoName ) ) { return clonable( false ) }

    // LOGGING
    var repoInfo = extractRepoInfoFromPath( repoName )
    logger.log( logger.EVENT.INIT_CLONE, repoInfo.userId, repoInfo.exerciseName )

    createRepo( repoName )
    .done( function() {
        clonable( true )
    }, function( err ) {
        clonable( false )
        // LOGGING
        logger.err( logger.ERR.CREATE_REPO, repoInfo.userId, repoInfo.exerciseName, {
            msg: err.message
        })
    })
})

// hard resets and checks out the updated HEAD after a push to a non-bare remote repo
// this can't be done inside of the post-receive hook, for some reason
// NOTE: when Git >= 2.3.0 is in APT, look into `receive.denyCurrentBranch updateInstead`
eventBus.setHandler( '*', 'receive', function( repo, action, updates, done ) {
    var repoPath = path.resolve( PATH_TO_REPOS, '.' + repo ),
        git = utils.git.bind( utils, repoPath ),
        isPushingShadowBranch = updates.reduce( function( isbr, update ) {
            return isbr || update.name === 'refs/heads/shadowbranch'
        }, false ),
        chain

    chain = git( 'reset', '--hard' )
    .then( function() {
        return git( 'checkout', ':/')
    })

    if ( isPushingShadowBranch ) {
        chain.then( function() {
            return git( 'update-ref', 'refs/gitstream/shadowbranch refs/heads/shadowbranch' )
        })
        .then( function() {
            return git( 'update-ref', '-d refs/heads/shadowbranch' )
        })
    }

    chain.catch( function( err ) {
        var repoInfo = extractRepoInfoFromPath( repo )
        // LOGGING
        logger.err( logger.ERR.ON_RECEIVE, repoInfo.userId, repoInfo.exerciseName, {
            msg: err.message
        })
    })
    .done( function() {
        done()
    })
})

// set up a session cookie to hold the user's identity after authentication
const sessionParser = session({
    secret: settings.sessionSecret || crypto.pseudoRandomBytes(16).toString('hex'),
    sameSite: 'lax',
    signed: true,
    overwrite: true,
});
app.use(sessionParser);

// setUserAuthenticateIfNecessary: this middleware sets req.user to an object { username:string, fullname:string }, either from
// session cookie information or by authenticating the user using the authentication method selected in settings.js.
//
// By default there is no authentication method, so this method authenticates as a guest user with a randomly-generated username.
let setUser = function(req,res,next) {
    if ( ! req.user ) {
        if (req.session.guest_user){
            req.user = req.session.guest_user;
        } else {
            req.user = req.session.guest_user = { username: user.createRandomId(), fullname: "Guest User" }
        }
    }
    console.log('guest user connected as', req.user);
    next();
};

let setUserAuthenticateIfNecessary = setUser; 

async function configureApp() {
    // // if we have settings for OpenID authentication, configure it
    if (settings.openid) {

        const passport = new Passport();
        const openidissuer = await openidclient.Issuer.discover(settings.openid.serverUrl);
        const client = new openidissuer.Client({
            client_id: settings.openid.clientId,
            client_secret: settings.openid.clientSecret,
            redirect_uris: [ settings.openid.clientUrl + (settings.openid.clientUrl.endsWith('/') ? '' : '/') + 'auth' ]
        });

        // https://github.com/panva/node-openid-client/blob/master/docs/README.md#customizing-clock-skew-tolerance
        client[(openidclient.custom).clock_tolerance] = 'clockTolerance' in settings.openid ? settings.openid.clockTolerance : 5;
        
        var usernameFromEmail = settings.openid.usernameFromEmail || ((email) => email);
        
        passport.use('openid', new openidclient.Strategy({
            client,
            params: { scope: 'openid email profile' },
        }, (tokenset, passportUserInfo, done) => {
            console.log('passport returned', passportUserInfo);
            const username = usernameFromEmail(passportUserInfo.email || '');
            const fullname = passportUserInfo.name || '';
            done(null, { username, fullname });
        }));
        const returnUserInfo = (userinfo, done) => done(null, userinfo);
        passport.serializeUser(returnUserInfo);
        passport.deserializeUser(returnUserInfo);
        
        const passportInit = passport.initialize();
        app.use(passportInit);
        const passportSession = passport.session();
        app.use(passportSession);
        app.use('/auth',
                (req, res, next) => {
                    passport.authenticate(
                        'openid',
                        // see "Custom Callback" at http://www.passportjs.org/docs/authenticate/
                        (err, user, info) => {
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
                                    return res.redirect(req.session.returnTo);
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
                return res.redirect('/auth');
            }
            console.log('OpenID authenticated as', req.user);
            next();
        }

        console.log('openid auth is ready');
    }

    app.use( compression() )
    app.use( '/repos', backend )
    app.use( '/hooks', githookEndpoint )

    // invoked from the "go" script in client repo
    app.use( '/go', function( req, res ) {
        if ( !req.headers['x-gitstream-repo'] ) {
            res.writeHead(400)
            return res.end()
        }

        var remoteUrl = req.headers['x-gitstream-repo'],
            repo = remoteUrl.substring( remoteUrl.indexOf( gitHTTPMount ) + gitHTTPMount.length )

        createRepo( repo )
        .done( function( repoInfo ) {
            // only 1 instance of publish
            // note: this messaging system will kept for now
            const handlePublishError =  logDbErr( repoInfo.userId, repoInfo.exerciseName, {
                desc: 'userMap go emit'
            })

            try {
                exerciseEvents.emit(repoInfo.userId + ':go', repoInfo.exerciseName); 
            } catch (error) {
                handlePublishError(error);
            }

            res.writeHead( 200 )
            res.end()
        }, function( err ) {
            res.writeHead( 403 )
            res.end()
            // LOGGING
            logger.err( logger.ERR.CREATE_REPO, null, null, {
                desc: 'New repo on go',
                repo: repo,
                remoteUrl: remoteUrl,
                msg: err.message
            })
        })
    })

    app.use( '/login', setUserAuthenticateIfNecessary, function( req, res ) {
        res.redirect(req.originalUrl.replace(/^\/login/, '/'));
    })

    app.use( '/user', setUser, function( req, res ) {
        const userId = ( req.user && req.user.username ) || "";
        res.writeHead( 200, { 'Content-Type': 'text/plain' } )
        res.end( userId )
    })
}
configureApp().catch(err => console.error(err));

// Start the server using the shorthand provided by Express
server = app.listen(PORT)

// Create a WebSocket connection ontop of the Express app
// todo: this config might need additional tweaks (though, it does work rn)
const wss = new WebSocket.Server({
    server: server,
    path: EVENTS_ENDPOINT
});


class ClientConnection {
    constructor(ws) {
        // one client = one socket
        this.ws = ws;

        // Shared state variables
        this.exerciseMachine = null;
        this.userId = null;
        this.userKey = null;

        // Shared socket listeners
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onerror = this.handleError.bind(this);
        this.ws.onclose = this.handleClose.bind(this);    

        // Start heartbeat with client (temporary measure to ensure connection persists)
        this.startHeartbeat();

        if (logger.CONFIG.WS_DEBUG_IND) this.sendMessage('ws', 'Hi from Server!');
    }

    /**
     * Pings client every 55 seconds (less than the standard Nginx connection halt of 60 seconds).
     * If no response, connection presumed dead
     */
    startHeartbeat() {
        const hb_time = 55*1000;

        this.heartbeat = setInterval(() => {
            this.ws.ping();
        }, hb_time);
    }

    /**
     * Sends messages to established client.
     * 
     * @param {typeof EVENTS | 'ws' | 'err'} msgEvent
     * @param {any} msgData the object to be transmitted
     */
    sendMessage(msgEvent, msgData) {
        const msg = {event: msgEvent, data: msgData};
        const strMsg = JSON.stringify(msg);

        try {
            this.ws.send(strMsg);
            logger.ws(WS_TYPE.SENT, msg);
        } catch (error) { // todo: more graceful error handling?
            console.error('Error sending message:', error);
        }

    }

    handleMessage(event) {
        const msg = JSON.parse(event.data);
        const {event: msgEvent, data: msgData} = msg;
        
        logger.ws(WS_TYPE.RECEIVED, msg);

        switch (msgEvent) {
            case EVENTS.sync:
                this.handleClientSync(msgData);
                break;
            
            case EVENTS.exerciseDone:
                this.handleExerciseDone(msgData);
                break;

            case EVENTS.exerciseChanged:
                this.handleExerciseChanged(msgData);
                break;
        
            // Special case to relay info about socket connection
            case 'ws':
                if (logger.CONFIG.WS_DEBUG_SUM)
                    console.log('ws message received: ', msg)
                break;
            
            // Special case to handle errors
            case 'err':
                if (logger.CONFIG.WS_DEBUG_SUM)
                    console.log('error event received:', msg)
                break;

            default:
                if (logger.CONFIG.WS_DEBUG_SUM)
                    console.error("error, unknown event: ", msgEvent);
        }
    }

    // per socket
    handleError(event) {
        console.error('ws connection error:', event);
    }
    
    // per socket
    handleClose(event) {
        if (this.exerciseMachine) {
            this.exerciseMachine.removeAllListeners()
            this.exerciseMachine.halt()
        }

        // Stop the heartbeat when the connection is closed
        clearInterval(this.heartbeat);

        this.removeFromActiveList();
    
        logger.log(logger.EVENT.QUIT, this.userId, null)
    }

    // === Expiremental feature to maintain list of active connections ===

    addToActiveList() {
        // Add the new connection to the array of active connections
        activeConnections.push(this.userId);

        // Log the number of active connections
        if (logger.CONFIG.WS_DEBUG_SUM) {
            // todo: log these to MongoDB entry
            console.log(`\n[New connection] List of Active Users:\n${activeConnections.join('\n')}\n`);
        }        
    }

    removeFromActiveList() {
        // Remove the connection from the array of active connections
        activeConnections = activeConnections.filter(userId => userId !== this.userId);

        if (logger.CONFIG.WS_DEBUG_SUM) {
            // Log the number of active connections
            console.log(`\n[Connection Closed] List of Active Users:\n${activeConnections.join('\n')}\n`);
        }
    }


    // ======= Shared Event Handlers =======

    /**
     * Sync the client with the stored client state
     * 
     * @param {*} recvUserId 
     */
    handleClientSync(recvUserId) {
        this.userId = recvUserId; // initial and sole assignment
        this.addToActiveList();

        var userKeyPromise = user.getUserKey( this.userId )
    
        userKeyPromise.done( ( key ) => { this.userKey = key }, ( err ) => {
            // LOGGING
            logger.err(logger.ERR.DB, this.userId, null, {msg: err.message})
        })
    
        const handleClientState = ( err, clientState ) => {
            if ( err ) {
                console.error(err)
    
                // LOGGING
                logger.err( logger.ERR.DB, this.userId, null, {
                    desc: 'userMap get client state',
                    msg: err.message
                })
    
                return this.sendMessage('err', err) // todo: stringify the error?
            }

            if ( !clientState ) { // Aka user is new and we want to initialize their data

                console.error('hmset', FIELD_EXERCISE_STATE, null);
                
                const handleUnsetClientState = logDbErr( this.userId, null, {
                    desc: 'userMap unset client state'
                })
    
                userMap.set(this.userId, FIELD_EXERCISE_STATE, "", handleUnsetClientState)
            }
    
            userKeyPromise.then( ( userKey ) => { // not used because is the same as `this.userKey`
                var exerciseState = clientState[ FIELD_EXERCISE_STATE ],
                    currentExercise = clientState[ FIELD_CURRENT_EXERCISE ]
    
                // LOGGING
                logger.log( logger.EVENT.SYNC, this.userId, currentExercise, {
                    exerciseState: exerciseState
                })
    
                if ( exerciseState) {

                    // there's already an excercise running. reconnect to it
                    console.log('user refreshed page!')
                    this.exerciseMachine = this.createExerciseMachine( currentExercise )
                    this.exerciseMachine.init( exerciseState)
    
                } else if ( exerciseState ) { // last exercise has expired
                    userMap.delete(this.userId, [FIELD_EXERCISE_STATE]);
    
                    delete clientState[ FIELD_EXERCISE_STATE ]
                }
                
                clientState.user = {
                    key: this.userKey,
                    id: this.userId
                }
    
                this.sendMessage(EVENTS.sync, clientState);
            })
        };
        

        userMap.getAll(this.userId, handleClientState);
    
        const processNewExercise = ( channel, exerciseName ) => {
            // LOGGING
            logger.log( logger.EVENT.GO, this.userId, exerciseName )
    
            const handleExerciseState = ( err, state ) => {
                var startState
                
                console.error('hgetall', this.userId, state);
    
                // only start exercise if user is on the exercise page
                if (exerciseName !== state.currentExercise) return
    
                if (this.exerciseMachine) {
                    this.exerciseMachine.halt()
                }
    
                this.exerciseMachine = this.createExerciseMachine( exerciseName )
                startState = this.exerciseMachine._states.startState
                // set by EM during init, but init sends events. TODO: should probably be fixed
    
                console.error('hmset', FIELD_EXERCISE_STATE, startState);
                
                const handleError = function( err ) {
                    if ( err ) {
                        // LOGGING
                        logger.err( logger.ERR.DB, this.userId, exerciseName, {
                            desc: 'userMap go',
                            msg: err.message
                        })
                    }
                }
                userMap.set(this.userId, FIELD_EXERCISE_STATE, startState, handleError);
    
                state[ FIELD_EXERCISE_STATE ] = startState
    
                this.sendMessage(EVENTS.sync, state);
    
                this.exerciseMachine.init()
            }
            userMap.getAll(this.userId, handleExerciseState)
        }
    
        exerciseEvents.on(this.userId + ':go', (exerciseName) => {
            processNewExercise(null, exerciseName)
        });
    }

    // user changed exercise page
    handleExerciseChanged(newExercise) {

        if (this.exerciseMachine) { // stop the old machine
            this.exerciseMachine.halt()
            // aka, previous exercise progress is wiped when user change to a new one
            // todo: keep data persistent? possibly a bug tbh

            this.exerciseMachine = null
        }
    
        console.error('hset', this.userId, FIELD_CURRENT_EXERCISE, newExercise);
        
        const handleNewExercise = logDbErr(this.userId, newExercise, {
            desc: 'userMap change exercise'
        })
    
        userMap.delete(this.userId, [FIELD_EXERCISE_STATE], handleNewExercise);
        userMap.set(this.userId, FIELD_CURRENT_EXERCISE, newExercise, handleNewExercise);
    
        // LOGGING
        logger.log( logger.EVENT.CHANGE_EXERCISE, this.userId, newExercise )
    }

    handleExerciseDone(doneExercise) {
        utils.exportToOmnivore(this.userId, doneExercise,
            logDbErr( this.userId, doneExercise, { desc: 'Omnivore POST error' } ));
    }


    createExerciseMachine(exerciseName) {
        var emConf = exerciseConfs.machines[ exerciseName ](),
            repoMac = user.createMac( this.userKey, this.userId + exerciseName ),
            exerciseRepo = createRepoShortPath({
                userId: this.userId,
                exerciseName: exerciseName,
                mac: repoMac
            }),
            repoPaths = {
                fsPath: path.join( PATH_TO_REPOS, exerciseRepo ), // repo fs path
                path: exerciseRepo // repo short path
            },
            exerciseDir = path.join( PATH_TO_EXERCISES, exerciseName )
    
        let exerciseMachine = new ExerciseMachine( emConf, repoPaths, exerciseDir, eventBus ) // local
    
        const unsetExercise = () => {
            userMap.delete(this.userId, [FIELD_EXERCISE_STATE]);
        }
    
        const stepHelper = (newState) => {
            console.error('hset', this.userId, FIELD_EXERCISE_STATE, newState);
    
            const updateState =  logDbErr( this.userId, exerciseName, {
                desc: 'userMap step update exercise state',
                newState: newState
            });
    
            userMap.set(this.userId, FIELD_EXERCISE_STATE, newState, updateState);
    
        }
    
        /**
         * Called when one of these events happen: EVENTS.halt, EVENTS.step
         * (see below with registerListener and when it's called)
         * and sends said event to the browser
         *  
         * @param {*} listenerDef 
         * @returns function
         */
        const makeListenerFn = (listenerDef) => {
            // send message via websocket and call upon helper function


            // todo: refactor this function 
            return (...args) => {
                this.sendMessage(listenerDef.event, args);
    
                listenerDef.helper(...args);
    
                logger.log(logger.EVENT.EM, this.userId, exerciseName, {
                        type: listenerDef.event,
                        info: args.slice( 1 )
                    }
                )
            }
        }
    
        const registerListener = (eventType, helper) => {
            exerciseMachine.on(eventType, makeListenerFn({ event: eventType, helper: helper}));
        }
    
        // set up listeners to send events to browser and update saved exercise state
        registerListener(EVENTS.halt, unsetExercise);
        registerListener(EVENTS.step, stepHelper);
    
        return exerciseMachine;
    }

}

let activeConnections = [];

// Create a new websocket connection
wss.on('connection', function(ws) {
    // bug: handling multiple users from the same source (eg userId)
    new ClientConnection(ws);
});
