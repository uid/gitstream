// Imported libraries -- EXTERNAL
const compression = require('compression'),
    express = require('express'),
    duplexEmitter = require('duplex-emitter'),
    path = require('path'),
    q = require('q'),
    rimraf = require('rimraf'),
    shoe = require('shoe'),
    WebSocket = require('ws'),
    session = require('cookie-session'),
    { Passport } = require('passport'),
    openidclient = require('openid-client'),
    crypto = require('crypto'),
    EventEmitter = require('events'),
    { spawn } = require('child_process'),
    mongodb = q.nfcall( require('mongodb').MongoClient.connect, 'mongodb://localhost/gitstream' ).then(client => client.db());

// Imported libraries -- INTERNAL
const ExerciseMachine = require('./ExerciseMachine'),
    utils = require('./utils'),
    angler = require('git-angler'),
    exerciseConfs = require('gitstream-exercises'),
    settings = require('../../settings'),
    { WS_TYPE, ...logger } = require('./logger')({ dbcon: mongodb }), // LOGGING
    user = require('./user')({ dbcon: mongodb });

// Global variables -- CONSTANT
const PATH_TO_REPOS = '/srv/repos',
    PATH_TO_EXERCISES = __dirname + '/exercises/',
    CLIENT_IDLE_TIMEOUT = 60 * 60 * 1000, // 1 hr before resting client state expires
    PORT = 4242,
    REPO_NAME_REGEX = /\/[a-z0-9_-]+\/[a-f0-9]{6,}\/.+.git$/,
    gitHTTPMount = '/repos'; // no trailing slash

const FIELD_EXERCISE_STATE = 'exerciseState',
    FIELD_END_TIME = 'endTime',
    FIELD_CURRENT_EXERCISE = 'currentExercise'

// Global variables -- DYNAMIC
var app = express(), // todo: might constant, but leaving here for now
    eventBus = new angler.EventBus(), // todo: might constant, but leaving here for now
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

const EVENTS = {
    sync: 'sync',
    exerciseDone: 'exerciseDone',
    exerciseChanged: 'exerciseChanged',
    step: 'step',
    ding: 'ding',
    halt: 'halt'
}

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
     * Deletes user data after timeout expires. If user not in map, nothing happens.
     *
     * @param {string} userID - The ID of the user.
     * @param {number} timeout - The timeout duration in milliseconds.
     * @param {errorCallback} callback - The optional callback to be invoked if the operation fails.
     * @returns {void} - This function does not return anything (mutator function).
     */
    expire(userID, timeout, callback=null) {
        if (!this[userID]) {
          if (callback)
            return callback(null);
          return
        }
        // report user data before expire was initialized
        logger.userMapMod(this, userID, 'expire');

        setTimeout(() => {
          try {
            delete this[userID];
            logger.userMapMod(this, userID, 'expire');

            if (callback)
              return callback(null);
          } catch (err) {
            if (callback)
              return callback(err);
          }
        }, timeout);
    },

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

    if ( !repoInfo ) { throw Error('Could not get repo info') }

    return user.verifyMac( repoInfo.userId, repoInfo.mac, repoInfo.macMsg )
    .then( function() {
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
        var userId = ( req.user && req.user.username ) || "";
        res.writeHead( 200, { 'Content-Type': 'text/plain' } )
        res.end( userId )
    })
}
configureApp().catch(err => console.error(err));

// Start the server using the shorthand provided by Express
server = app.listen( PORT )


// ========= Start of WS =========

// Create a WebSocket connection ontop of the Express app
const EVENTS_ENDPOINT_WS = '/events_ws';

const wss = new WebSocket.Server({ // todo: this config might be sus but it works
    server: server,
    path: EVENTS_ENDPOINT_WS
});

let one_socket;

function sendMessage(msgEvent, msgData) {
    const msg = {event: msgEvent, data: msgData};
    const strMsg = JSON.stringify(msg);

    logger.ws(WS_TYPE.SENT, strMsg);
    one_socket.send(strMsg);
}


wss.on('connection', function(ws) {
    one_socket = ws;

    if (logger.CONFIG.WS_DEBUG) sendMessage('ws', 'Hi from server!');

    ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        
        logger.ws(WS_TYPE.RECEIVED, JSON.stringify(msg));

        const {event: msgEvent, data: msgData} = msg;

        switch (msgEvent) {
            case EVENTS.sync:
                handleClientSync(msgData);
            break;
            
            case EVENTS.exerciseDone:
                handlExerciseDone(msgData);
            break;

            case EVENTS.exerciseChanged:
                handleExerciseChanged(msgData);
            break;

            case EVENTS.step:
                // todo
            break;

            case EVENTS.ding:
                // todo
            break;

            case EVENTS.halt:
                // todo
            break;
         
            // Special case to relay info about socket connection
            case 'ws':
                console.log('ws message received:', msg)
            break;
            
            default:
                console.error("error: unknown event: ", msgEvent);
            }
    };

    ws.onerror = (event) => { // todo: gracefully handling client connection error?
        console.error('WS Error:', event);
    };

    wss.onclose = function(event) {
        handleClose();
    };
});

// ========= End of WS =========

// State variables
var exerciseMachine,
    userId, 
    userKey,
    clientEvents

/**
 * Handling server death
 */
function handleClose() {
    if (exerciseMachine) {
        exerciseMachine.removeAllListeners()
        exerciseMachine.halt()
    }

    // LOGGING
    logger.log( logger.EVENT.QUIT, userId, null )
}

function createExerciseMachine(exerciseName) {
    var emConf = exerciseConfs.machines[ exerciseName ](),
        repoMac = user.createMac( userKey, userId + exerciseName ),
        exerciseRepo = createRepoShortPath({
            userId: userId,
            exerciseName: exerciseName,
            mac: repoMac
        }),
        repoPaths = {
            fsPath: path.join( PATH_TO_REPOS, exerciseRepo ), // repo fs path
            path: exerciseRepo // repo short path
        },
        exerciseDir = path.join( PATH_TO_EXERCISES, exerciseName ),
        exerciseMachine = new ExerciseMachine( emConf, repoPaths, exerciseDir, eventBus ),

        makeListenerFn = function( listenerDef ) {
            // called when a step happens and sends the event to the browser
            return function() {
                var args = Array.prototype.slice.call( arguments ),
                    eventArgs = [ listenerDef.event ].concat( args )
                clientEvents.emit.apply( clientEvents, eventArgs )

                listenerDef.helper.apply( null, args )

                // LOGGING
                logger.log( logger.EVENT.EM, userId, exerciseName, {
                    type: listenerDef.event,
                    info: args.slice( 1 )
                })
            }
        },
        unsetExercise = function() {
            userMap.delete(userId, [FIELD_EXERCISE_STATE, FIELD_END_TIME]);

        },
        listeners = [
            { event: EVENTS.ding, helper: unsetExercise },
            { event: EVENTS.halt, helper: unsetExercise },
            { event: EVENTS.step, helper: function( newState ) { // step seems to be important, why?
                console.error('hset', userId, FIELD_EXERCISE_STATE, newState);

                const updateState =  logDbErr( userId, exerciseName, {
                    desc: 'userMap step update exercise state',
                    newState: newState
                });

                userMap.expire(userId, CLIENT_IDLE_TIMEOUT, updateState);
                userMap.set(userId, FIELD_EXERCISE_STATE, newState, updateState);

            } }
        ]

    // set up listeners to send events to browser and update saved exercise state
    listeners.forEach( function( listener ) {
        exerciseMachine.on( listener.event, makeListenerFn( listener ) )
    })

    return exerciseMachine
}

/**
 * Sync the client with the stored client state
 * @param {*} ws 
 * @param {*} recvUserId 
 */
function handleClientSync(recvUserId) {
    userId = recvUserId // initial and sole assignment

    var userKeyPromise = user.getUserKey( userId )

    userKeyPromise.done( function( key ) { userKey = key }, function( err ) {
        // LOGGING
        logger.err( logger.ERR.DB, userId, null, { msg: err.message } )
    })

    const handleClientState = function( err, clientState ) {
        if ( err ) {
            console.error(err)

            // LOGGING
            logger.err( logger.ERR.DB, userId, null, {
                desc: 'userMap get client state',
                msg: err.message
            })
            
            return clientEvents.emit( 'err', err )
        }
        console.error('hgetall', userId, clientState);
        if ( !clientState ) { // Aka user is new and we want to initialize their data
            console.error('hmset', FIELD_EXERCISE_STATE, null);
            
            const handleUnsetClientState = logDbErr( userId, null, {
                desc: 'userMap unset client state'
            })

            userMap.set(userId, FIELD_EXERCISE_STATE, "", handleUnsetClientState)
        }

        userKeyPromise.then( function( userKey ) {
            var timeRemaining = clientState[ FIELD_END_TIME ] - Date.now() || undefined,
                exerciseState = clientState[ FIELD_EXERCISE_STATE ],
                currentExercise = clientState[ FIELD_CURRENT_EXERCISE ]

            // LOGGING
            logger.log( logger.EVENT.SYNC, userId, currentExercise, {
                timeRemaining: timeRemaining,
                exerciseState: exerciseState
            })

            if ( exerciseState && ( timeRemaining === undefined || timeRemaining > 0 ) ) {
                // there's already an excercise running. reconnect to it
                exerciseMachine = createExerciseMachine( currentExercise )
                exerciseMachine.init( exerciseState, timeRemaining / 1000 )

            } else if ( exerciseState ) { // last exercise has expired
                userMap.delete(userId, FIELD_EXERCISE_STATE, FIELD_END_TIME);

                delete clientState[ FIELD_EXERCISE_STATE ]
                delete clientState[ FIELD_END_TIME ]
            }

            clientState.user = {
                key: userKey,
                id: userId
            }
            clientState.timeRemaining = clientState.endTime - Date.now()
            delete clientState[ FIELD_END_TIME ]

            sendMessage(EVENTS.sync, clientState);
            // clientEvents.emit(EVENTS.sync, clientState);
        })
    };

    userMap.getAll(userId, handleClientState)

    function processNewExercise( channel, exerciseName ) {
        // LOGGING
        logger.log( logger.EVENT.GO, userId, exerciseName )

        const handleExerciseState = function( err, state ) {
            var startState, endTime
            
            console.error('hgetall', userId, state);

            // only start exercise if user is on the exercise page
            if ( exerciseName !== state.currentExercise ) return

            if ( exerciseMachine ) {
                exerciseMachine.halt()
            }

            exerciseMachine = createExerciseMachine( exerciseName )
            startState = exerciseMachine._states.startState
            // set by EM during init, but init sends events. TODO: should probably be fixed
            // note: time limit ultimately comes from parameter set in `gitstream-exercises>machines.js`
            endTime = Date.now() + exerciseMachine._timeLimit * 1000

            console.error('hmset', FIELD_EXERCISE_STATE, startState,
                   FIELD_END_TIME, endTime );
            
            const handleError = function( err ) {
                if ( err ) {
                    // LOGGING
                    logger.err( logger.ERR.DB, userId, exerciseName, {
                        desc: 'userMap go',
                        msg: err.message
                    })
                }
            }
            userMap.expire(userId, CLIENT_IDLE_TIMEOUT, handleError);
            userMap.set(userId, FIELD_EXERCISE_STATE, startState, handleError);
            userMap.set(userId, FIELD_END_TIME, endTime, handleError);

            state[ FIELD_EXERCISE_STATE ] = startState
            state.timeRemaining = exerciseMachine._timeLimit * 1000
            delete state[ FIELD_END_TIME ]

            sendMessage(EVENTS.sync, state);
            // clientEvents.emit( EVENTS.sync, state )

            exerciseMachine.init()
        }
        userMap.getAll(userId, handleExerciseState)
    }

    exerciseEvents.on(userId + ':go', (exerciseName) => {
        processNewExercise(null, exerciseName)
    });
}

function handleExerciseChanged(newExercise) {
    if (exerciseMachine) { // stop the old machine
        exerciseMachine.halt()
        exerciseMachine = null
    }

    console.error('hset', userId, FIELD_CURRENT_EXERCISE, newExercise);
    
    const handleNewExercise = logDbErr(userId, newExercise, {
        desc: 'userMap change exercise'
    })

    userMap.expire(userId, CLIENT_IDLE_TIMEOUT, handleNewExercise);
    userMap.delete(userId, [FIELD_EXERCISE_STATE, FIELD_END_TIME], handleNewExercise);
    userMap.set(userId, FIELD_CURRENT_EXERCISE, newExercise, handleNewExercise);

    // LOGGING
    logger.log( logger.EVENT.CHANGE_EXERCISE, userId, newExercise )
}

function handlExerciseDone(doneExercise) {
    utils.exportToOmnivore(userId, doneExercise,
        logDbErr( userId, doneExercise, { desc: 'Omnivore POST error' } ));
}

shoe( function( stream ) {
    clientEvents = duplexEmitter(stream);

    stream.on('close', handleClose);

    // todo: remove these shoe events
    // clientEvents.on(EVENTS.sync, handleClientSync.bind( this ) )
    // clientEvents.on(EVENTS.exerciseDone, handlExerciseDone);
    // clientEvents.on(EVENTS.exerciseChanged, handleExerciseChanged);

}).install( server, '/events' )
