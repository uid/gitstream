var angler = require('git-angler'),
    compression = require('compression'),
    connect = require('connect'),
    duplexEmitter = require('duplex-emitter'),
    path = require('path'),
    q = require('q'),
    redis = require('redis'),
    rimraf = require('rimraf'),
    shoe = require('shoe'),
    spawn = require('child_process').spawn,
    mongodb = q.nfcall( require('mongodb').MongoClient.connect, 'mongodb://localhost/gitstream' ),
    logger = require('./logger')({ dbcon: mongodb }), // LOGGING
    user = require('./user')({ dbcon: mongodb }),
    exerciseConfs = require('gitstream-exercises'),
    ExerciseMachine = require('./ExerciseMachine'),
    utils = require('./utils'),
    app = connect(),
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
            logger.err( logger.ERR.DB, userId, exercise, data )
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

app.use( '/user', function( req, res ) {
    var userRe = /([a-z0-9_-]{0,8})@MIT.EDU/,
        match = userRe.exec( req.headers['x-ssl-client-s-dn'] ),
        userId = ( match ? match[1] : null ) || user.createRandomId()
    res.writeHead( 200, { 'Content-Type': 'text/plain' } )
    res.end( userId )
})

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
                },
                listeners = [
                    { event: 'ding', helper: unsetExercise },
                    { event: 'halt', helper: unsetExercise },
                    { event: 'step', helper: function( newState ) {
                        rcon.multi()
                        .expire( userId, CLIENT_IDLE_TIMEOUT )
                        .hset( userId, FIELD_EXERCISE_STATE, newState )
                        .exec( logDbErr( userId, exerciseName, {
                            desc: 'Redis step update exercise state',
                            newState: newState
                        }) )
                    } }
                ]

            // set up listeners to send events to browser and update saved exercise state
            listeners.forEach( function( listener ) {
                exerciseMachine.on( listener.event, makeListenerFn( listener ) )
            })

            return exerciseMachine
        }

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
            if ( !clientState ) {
                clientState = { currentExercise: null }
                rcon.hmset( userId, clientState, logDbErr( userId, null, {
                    desc: 'Redis unset client state'
                }) )
            }

            userKeyPromise.then( function( userKey ) {
                var timeRemaining = clientState[ FIELD_END_TIME ] - Date.now() || undefined,
                    exerciseState = clientState[ FIELD_EXERCISE_STATE ],
                    currentExercise = clientState[ FIELD_CURRENT_EXERCISE ]

                // LOGGING
                logger.log( logger.EVENT.SYNC, userId, currentExercise, {
                    timeRemaining: timeRemaining,
                    exercieState: exerciseState
                })

                if ( exerciseState && ( timeRemaining === undefined || timeRemaining > 0 ) ) {
                    // there's already an excercise running. reconnect to it
                    exerciseMachine = createExerciseMachine( currentExercise )
                    exerciseMachine.init( exerciseState, timeRemaining / 1000 )

                } else if ( exerciseState ) { // last exercise has expired
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

        rsub.subscribe( userId + ':go' )
        rsub.on( 'message', function( channel, exerciseName ) {
            // LOGGING
            logger.log( logger.EVENT.GO, userId, exerciseName )

            rcon.hgetall( userId, function( err, state ) {
                var startState,
                    endTime

                // only start exercise if user is on the exercise page
                if ( exerciseName !== state.currentExercise ) { return }

                if ( exerciseMachine ) { exerciseMachine.halt() }
                exerciseMachine = createExerciseMachine( exerciseName )
                startState = exerciseMachine._states.startState
                // set by EM during init, but init sends events. TODO: should probably be fixed
                endTime = Date.now() + exerciseMachine._timeLimit * 1000

                rcon.multi()
                    .expire( userId, CLIENT_IDLE_TIMEOUT )
                    .hmset( userId,
                       FIELD_EXERCISE_STATE, startState,
                       FIELD_END_TIME, endTime )
                    .exec( function( err ) {
                        if ( err ) {
                            // LOGGING
                            logger.err( logger.ERR.DB, userId, exerciseName, {
                                desc: 'Redis go',
                                msg: err.message
                            })
                        }
                    })

                state[ FIELD_EXERCISE_STATE ] = startState
                state.timeRemaining = exerciseMachine._timeLimit * 1000
                delete state[ FIELD_END_TIME ]

                clientEvents.emit( 'sync', state )

                exerciseMachine.init()
            })
        })

    }.bind( this ) )

    clientEvents.on( 'exerciseChanged', function( newExercise ) {
        if ( exerciseMachine ) { // stop the old machine
            exerciseMachine.halt()
            exerciseMachine = null
        }

        rcon.multi()
            .expire( userId, CLIENT_IDLE_TIMEOUT )
            .hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME )
            .hset( userId, FIELD_CURRENT_EXERCISE, newExercise )
            .exec( logDbErr( userId, newExercise, { desc: 'Redis change exercise' } ) )

        // LOGGING
        logger.log( logger.EVENT.CHANGE_EXERCISE, userId, newExercise )
    })
}).install( server, '/events' )
