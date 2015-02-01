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
    user = require('./user')({ dbcon: mongodb, logger: logger }),
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
    logErr = function( err ) { if ( err ) { console.error( 'Error: ' + err ) } }

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
        var commits = q.promise( function( resolve ) {
                var commitsConf = exerciseConfs.repos[ repoInfo.exerciseName ]().commits
                if ( Array.isArray( commitsConf ) && commitsConf.length ) {
                    resolve( commitsConf )
                } else if ( typeof commitsConf === 'function' ) {
                    commitsConf( pathToExercise, resolve )
                } else {
                    resolve()
                }
            }).catch( function( err ) { done.reject( err ) })

        return utils.mkdirp( path.dirname( pathToRepo ) )
        .then( utils.cpr.bind( null, pathToStarterRepo, pathToRepo ) )
        .then( function() {
            return commits.then( function( commits ) {
                if ( commits ) {
                    return commits
                    .map( function( commit ) {
                        return utils.addCommit.bind( null, pathToRepo, pathToExercises, commit )
                    })
                    .reduce( q.when, q.filfill() )
                } else {
                    return utils.git( pathToRepo, 'commit', [ '-m', 'Initial commit' ] )
                }
            })
        })
    })
}

// transparently initialize exercise repos right before user clones it
eventBus.setHandler( '*', '404', function( repoName, _, data, clonable ) {
    if ( !repoNameRe.test( repoName ) ) { return clonable( false ) }

    // LOGGING
    var repoInfo = extractRepoInfoFromPath( repoName )
    logger.log( repoInfo.userId, logger.EVENT.REPO_404, repoInfo.userId, repoInfo.exerciseName )

    createRepo( repoName )
    .done( function() {
        clonable( true )
    }, function( err ) {
        clonable( false )
        console.error( err )
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
            cb({ ok: false, status: 404 })
            console.error( err )
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
        console.error( err )
    })
    .done( function() {
        done()
    })
})

// LOGGING
eventBus.addListener( 'logger', '*', '*', function( repo, action ) {
    if ( action !== 'clone' || action !== 'push' ) { return }
    var args = Array.prototype.slice.call( arguments ).slice(2),
        repoInfo = extractRepoInfoFromPath( repo ),
        data = {
            exercise: repoInfo.exerciseName,
            action: action,
            data: args
        }
    logger.log( repoInfo.userId, logger.EVENT.GIT, data )
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
        // LOGGING
        logger.log( repoInfo.userId, logger.EVENT.GO, repoInfo.exerciseName )

        rcon.publish( repoInfo.userId + ':go', repoInfo.exerciseName, logErr )
        res.writeHead( 200 )
        res.end()
    }, function( err ) {
        res.writeHead( 403 )
        res.end()
        console.error( err )
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
                        logger.log( userId, logger.EVENT.EM,
                                   { type: listenerDef.event, info: args.slice(1) })
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
                        .exec( logErr )
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
        logger.log( userId, logger.EVENT.QUIT )
    })

    // on connect, sync the client with the stored client state
    clientEvents.on( 'sync', function( recvUserId ) {
        userId = recvUserId

        var userKeyPromise = user.getUserKey( userId )

        userKeyPromise.done( function( key ) { userKey = key })

        rcon.hgetall( userId, function( err, clientState ) {
            if ( !clientState ) {
                clientState = { currentExercise: null }
                rcon.hmset( userId, clientState, logErr )
            }

            userKeyPromise.done( function( userKey ) {
                var timeRemaining = clientState[ FIELD_END_TIME ] - Date.now() || undefined,
                    exerciseState = clientState[ FIELD_EXERCISE_STATE ],
                    currentExercise = clientState[ FIELD_CURRENT_EXERCISE ]

                // LOGGING
                logger.log( userId, logger.EVENT.SYNC, {
                    timeRemaining: timeRemaining,
                    exercieState: exerciseState,
                    exerciseName: currentExercise
                })

                if ( err ) { return clientEvents.emit( 'err', err ) }

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
            logger.log( userId, logger.EVENT.GO, exerciseName )

            rcon.hgetall( userId, function( err, state ) {
                var startState

                // only start exercise if user is on the exercise page
                if ( exerciseName !== state.currentExercise ) { return }

                if ( exerciseMachine ) { exerciseMachine.halt() }
                exerciseMachine = createExerciseMachine( exerciseName )
                startState = exerciseMachine._states.startState

                rcon.multi()
                    .expire( userId, CLIENT_IDLE_TIMEOUT )
                    .hmset( userId,
                       FIELD_EXERCISE_STATE, startState,
                       FIELD_END_TIME, exerciseMachine.endTime )
                    .exec( logErr )

                state[ FIELD_EXERCISE_STATE ] = startState
                state.timeRemaining = exerciseMachine.endTime - Date.now()
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
            .exec( logErr )

        // LOGGING
        logger.log( userId, logger.EVENT.CHANGE_EXERCISE, newExercise )

    })
}).install( server, '/events' )
