var angler = require('git-angler'),
    compression = require('compression'),
    express = require('express'),
    duplexEmitter = require('duplex-emitter'),
    fs = require('fs'),
    path = require('path'),
    q = require('q'),
    redis = require('redis'),
    rimraf = require('rimraf'),
    shoe = require('shoe'),
    spawn = require('child_process').spawn,
    mongodb = q.nfcall( require('mongodb').MongoClient.connect, 'mongodb://localhost/gitstream' ).then(client => client.db()),
    logger = require('./logger')({ dbcon: mongodb }), // LOGGING
    user = require('./user')({ dbcon: mongodb }),
    exerciseConfs = require('gitstream-exercises'),
    ExerciseMachine = require('./ExerciseMachine'),
    utils = require('./utils'),
    app = express(),
    server,
    eventBus = new angler.EventBus(),
    PATH_TO_REPOS = '/srv/repos',
    PATH_TO_EXERCISES = __dirname + '/exercises/',
    repoNameRe = /\/[a-z0-9_-]+\/[a-f0-9]{6,}\/.+.git$/,
    backend,
    rcon = redis.createClient(),
    gitHTTPMount = '/repos', // no trailing slash
    githookEndpoint = angler.githookEndpoint({
        pathToRepos: PATH_TO_REPOS,
        eventBus: eventBus,
        gitHTTPMount: gitHTTPMount
    }),
    CLIENT_IDLE_TIMEOUT = 60 * 60 * 1000, // 1 hr before resting client state expires
    PORT = 4242,
    logDbErr = function( userId, exercise, data ) {
        return function ( err ) {
            if ( !err ) { return }
            data.msg = err.message
            console.error(err);
            logger.err( logger.ERR.DB, userId, exercise, data )
        }
    },
    session = require('cookie-session'),
    Passport = require('passport').Passport,
    PassportStrategy = require('passport').Strategy,
    openidclient = require('openid-client'),
    settings = require('../../settings'),
    crypto = require('crypto');

/**
 * Global map to store user progress. Methods encapsulated.
 */
let userMap = {
    /**
     * Deletes user data after timeout expires.
     *
     * @param {string} userID - The ID of the user. If not in map, nothing happens.
     * @param {number} timeout - The timeout duration in milliseconds.
     * @param {function} callback - The optional callback function to be invoked when the operation is finished.
     * @returns {null} - This function does not return anything (mutator function).
     */
    expire(userID, timeout, callback=null) {
        return null
    },

    /**
     * Sets a key-value pair for a specific user in the map. If the userID or key or value
     * cannot be found, the function has no effect.
     * 
     * @param {string} userID - The ID of the user in map.
     * @param {string} key - The key to be set or edited for the specified user.
     * @param {string} value - The value to be associated with the specified key for the user.
     * @param {function} callback - The optional callback function to be invoked when the operation is finished.
     * @returns {null} - This function does not return anything (mutator function).
     */
    set(userID, key, value, callback=null) {
        return null
    },

    /**
     * Deletes a list of keys and their associated objects for a specific user in a hash map. If the userID or any key
     * cannot be found, the function has no effect.
     * 
     * @param {string} userID - The ID of the user in the map. If not in the map, nothing happens.
     * @param {Array<string>} keys - The list of keys to be deleted along with their associated objects.
     * @param {function} callback - The optional callback function to be invoked when the operation is finished.
     * @returns {null} - This function does not return anything (mutator function).
     */
    delete(userID, keys, callback=null) {
        return null;
    },

    /**
     * Retrieves all the fields and values in the map associated with a specified user ID. If 
     * user not in map, nothing happens.
     * 
     * @param {string} userID - The ID of the user in map. If not in map, nothing happens.
     * @param {function} callback - The callback function to be invoked when the operation is finished.
     * @returns {null} - This function does not return anything (mutator function; callback function takes
     *                   care of additional tasks to perform with data retrieved).
     */
    getAll(userID, callback) {
        return null
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
    if ( !repoNameRe.test( repoName ) ) { return clonable( false ) }

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

backend = angler.gitHttpBackend({
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
let setUserAuthenticateIfNecessary = function(req,res,next) {
    if ( ! req.user ) {
        req.user = req.session.guest_user = { username: user.createRandomId(), fullname: "Guest User" }
    }
    console.log('guest user connected as', req.user);
    next();
};


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
            rcon.publish( repoInfo.userId + ':go', repoInfo.exerciseName,
                       logDbErr( repoInfo.userId, repoInfo.exerciseName, {
                           desc: 'Redis go publish'
                       }) )
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

    app.use( '/user', function( req, res ) {
        var userId = ( req.user && req.user.username ) || "";
        res.writeHead( 200, { 'Content-Type': 'text/plain' } )
        res.end( userId )
    })
}
configureApp().catch(err => console.error(err));

server = app.listen( PORT )

shoe( function( stream ) {
    var clientEvents = duplexEmitter( stream ),
        exerciseMachine,
        userId,
        userKey,
        rsub = redis.createClient(),
        FIELD_EXERCISE_STATE = 'exerciseState',
        FIELD_END_TIME = 'endTime',
        FIELD_CURRENT_EXERCISE = 'currentExercise',

        createExerciseMachine = function( exerciseName ) {
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
                    rcon.hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME )
                    logger.redisCall(rcon, userId, 'hdel');
                },
                listeners = [
                    { event: 'ding', helper: unsetExercise },
                    { event: 'halt', helper: unsetExercise },
                    { event: 'step', helper: function( newState ) { // step seems to be important, why?
                        console.error('hset', userId, FIELD_EXERCISE_STATE, newState);
                        rcon.multi()
                        .expire( userId, CLIENT_IDLE_TIMEOUT )
                        .hset( userId, FIELD_EXERCISE_STATE, newState )
                        .exec( logDbErr( userId, exerciseName, {
                            desc: 'Redis step update exercise state',
                            newState: newState
                        }) )
                        logger.redisCall(rcon, userId, 'expire, hset');
                    } }
                ]

            // set up listeners to send events to browser and update saved exercise state
            listeners.forEach( function( listener ) {
                exerciseMachine.on( listener.event, makeListenerFn( listener ) )
            })

            return exerciseMachine
        }

    // once server dies
    stream.on( 'close', function() {
        if ( exerciseMachine ) {
            exerciseMachine.removeAllListeners()
            exerciseMachine.halt()
        }
        rsub.quit()

        // LOGGING
        logger.log( logger.EVENT.QUIT, userId, null )
    })

    // on connect, sync the client with the stored client state
    clientEvents.on( 'sync', function( recvUserId ) {
        userId = recvUserId

        var userKeyPromise = user.getUserKey( userId )

        userKeyPromise.done( function( key ) { userKey = key }, function( err ) {
            // LOGGING
            logger.err( logger.ERR.DB, userId, null, { msg: err.message } )
        })

        rcon.hgetall( userId, function( err, clientState ) {
            if ( err ) {
                // LOGGING
                logger.err( logger.ERR.DB, userId, null, {
                    desc: 'Redis get client state',
                    msg: err.message
                })
                return clientEvents.emit( 'err', err )
            }
            console.error('hgetall', userId, clientState);
            if ( !clientState ) {
                console.error('hmset', FIELD_EXERCISE_STATE, null);
                rcon.hset( userId, FIELD_EXERCISE_STATE, null, logDbErr( userId, null, {
                    desc: 'Redis unset client state'
                }))
                logger.redisCall(rcon, userId, 'hset');
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
                    logger.redisCall(rcon, userId, 'hdel');
                    rcon.hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME )
                    delete clientState[ FIELD_EXERCISE_STATE ]
                    delete clientState[ FIELD_END_TIME ]
                }

                clientState.user = {
                    key: userKey,
                    id: userId
                }
                clientState.timeRemaining = clientState.endTime - Date.now()
                delete clientState[ FIELD_END_TIME ]

                clientEvents.emit( 'sync', clientState )
            })
        })
        logger.redisCall(rcon, userId, 'hgetall');

        // only 1 instance of subscribe
        rsub.subscribe( userId + ':go' )
        rsub.on( 'message', function( channel, exerciseName ) {
            // LOGGING
            logger.log( logger.EVENT.GO, userId, exerciseName )

            rcon.hgetall( userId, function( err, state ) {
                var startState,
                    endTime
                console.error('hgetall', userId, state);

                // only start exercise if user is on the exercise page
                if ( exerciseName !== state.currentExercise ) { return }

                if ( exerciseMachine ) { exerciseMachine.halt() }
                exerciseMachine = createExerciseMachine( exerciseName )
                startState = exerciseMachine._states.startState
                // set by EM during init, but init sends events. TODO: should probably be fixed
                // note: time limit ultimately comes from parameter set in `gitstream-exercises>machines.js`
                endTime = Date.now() + exerciseMachine._timeLimit * 1000

                console.error('hmset', FIELD_EXERCISE_STATE, startState,
                       FIELD_END_TIME, endTime );
                
                rcon.multi()
                    .expire( userId, CLIENT_IDLE_TIMEOUT )
                    .hset( userId,
                       FIELD_EXERCISE_STATE, startState)
                    .hset(userId,
                        FIELD_END_TIME, endTime)
                    .exec( function( err ) {
                        if ( err ) {
                            // LOGGING
                            logger.err( logger.ERR.DB, userId, exerciseName, {
                                desc: 'Redis go',
                                msg: err.message
                            })
                        }
                    })
                    logger.redisCall(rcon, userId, 'expire, 2x hset');

                state[ FIELD_EXERCISE_STATE ] = startState
                state.timeRemaining = exerciseMachine._timeLimit * 1000
                delete state[ FIELD_END_TIME ]

                clientEvents.emit( 'sync', state )

                exerciseMachine.init()
            })
            logger.redisCall(rcon, userId, 'hgetall');

        })
    }.bind( this ) )

    clientEvents.on( 'exerciseChanged', function( newExercise ) {
        if ( exerciseMachine ) { // stop the old machine
            exerciseMachine.halt()
            exerciseMachine = null
        }

        console.error('hset', userId, FIELD_CURRENT_EXERCISE, newExercise);
        rcon.multi()
            .expire( userId, CLIENT_IDLE_TIMEOUT )
            .hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME )
            .hset( userId, FIELD_CURRENT_EXERCISE, newExercise )
            .exec( logDbErr( userId, newExercise, { desc: 'Redis change exercise' } ) )
        logger.redisCall(rcon, userId, 'expire, hdel, hset');

        // LOGGING
        logger.log( logger.EVENT.CHANGE_EXERCISE, userId, newExercise )
    })

    clientEvents.on( 'exerciseDone', function( doneExercise ) {
        utils.exportToOmnivore(userId, doneExercise,
                    logDbErr( userId, doneExercise, { desc: 'Omnivore POST error' } ));
    })
}).install( server, '/events' )
