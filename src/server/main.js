var angler = require('git-angler'),
    compression = require('compression'),
    connect = require('connect'),
    duplexEmitter = require('duplex-emitter'),
    path = require('path'),
    q = require('q'),
    redis = require('redis'),
    shoe = require('shoe'),
    spawn = require('child_process').spawn,
    user = require('./user')({
        sqlHost: 'localhost', sqlUser: 'root', sqlPass: 'root', sqlDb: 'gitstream'
    }),
    exerciseConfs = require('gitstream-exercises'),
    ExerciseMachine = require('./ExerciseMachine'),
    utils = require('./utils'),
    app = connect(),
    server,
    eventBus = new angler.EventBus(),
    PATH_TO_REPOS = '/srv/repos',
    PATH_TO_EXERCISES = __dirname + '/exercises/',
    repoNameRe = /\/[a-z][a-z0-9_-]+\/[a-f0-9]{6,}-.+.git$/,
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
    logErr = function( err ) { if ( err ) { console.error( 'Error: ' + err ); } };

/**
 * Extracts data from the components of a repo's path
 * @param {String|Array} repoPath a path string or an array of path components
 * @return {Object|Boolean} data - if repo path is invalid, returns null
 *  { userId: String, exerciseName: String, mac: String, macMsg: String }
 */
function extractRepoInfoFromPath( repoPath ) {
    var splitRepoPath = repoPath instanceof Array ? repoPath : repoPath.split('/').slice(1),
        repoNameInfo,
        userId,
        repoMac,
        exerciseName,
        macMsg;

    if ( splitRepoPath.length < 2) {
        return null;
    }

    repoNameInfo = splitRepoPath[ splitRepoPath.length - 1 ].split('-');
    exerciseName = repoNameInfo.slice( 1 ).join('').replace( /\.git$/, '' );
    userId = splitRepoPath[ splitRepoPath.length - 2 ]; // e.g. /nhynes/repo.git - gets nhynes
    repoMac = repoNameInfo[0]; // e.g. /nhynes/12345-repo.git - gets 12345
    macMsg = userId + exerciseName; // e.g. nhynesexercise2

    return {
        userId: userId,
        exerciseName: exerciseName,
        mac: repoMac,
        macMsg: macMsg
    };
}

/** Does the inverse of @see extractRepoInfoFromPath. macMsg is not required */
function createRepoShortPath( info ) {
    return path.join( '/', info.userId, info.mac + '-' + info.exerciseName + '.git' );
}

/**
 * Verifies the MAC provided in a repo's path (ex. /username/beef42-exercise2.git)
 * @param {String|Array} repoPath a path string or an array of path components
 * @return {Promise}
 */
function verifyAndGetRepoInfo( repoPath ) {
    var repoInfo = extractRepoInfoFromPath( repoPath );

    if ( !repoInfo ) { throw Error('Could not get repo info'); }

    return user.verifyMac( repoInfo.userId, repoInfo.mac, repoInfo.macMsg )
    .then( function() {
        return repoInfo;
    });
}

// transparently initialize exercise repos right before user clones it
eventBus.setHandler( '*', '404', function( repoName, _, data, clonable ) {
    if ( !repoNameRe.test( repoName ) ) { return clonable( false ); }

    verifyAndGetRepoInfo( repoName )
    .catch( function() {
        clonable( false );
    })
    .done( function( repoInfo ) {
        var pathToRepo = path.join( PATH_TO_REPOS, repoName ),
            pathToExercise = path.join( PATH_TO_EXERCISES, repoInfo.exerciseName ),
            pathToStarterRepo = path.join( pathToExercise, 'starting.git' );

        spawn( 'mkdir', [ '-p', path.dirname( pathToRepo ) ] ).on( 'close', function( mkdirRet ) {
            if ( mkdirRet !== 0 ) { return clonable( false ); }

            spawn( 'cp', [ '-r', pathToStarterRepo, pathToRepo ] ).on( 'close', function( cpRet ) {
                if ( cpRet !== 0 ) { return clonable( false ); }

                var repoConf = exerciseConfs.repos[ repoInfo.exerciseName ]();

                if ( repoConf.commits && repoConf.commits.length ) {
                    q.all( repoConf.commits.map( function( commit ) {
                        return utils.gitAddCommit( pathToRepo, pathToExercise, commit );
                    }) )
                    .catch( function( err ) {
                        clonable( false );
                        console.error( err );
                    })
                    .done( function() {
                        clonable( true );
                    });
                } else {
                    utils.git( pathToRepo, 'add', ':/' )
                    .then( function() {
                        return utils.git( pathToRepo, 'commit', [ '-m', 'Initial commit' ] );
                    })
                    .catch( function( err ) {
                        clonable( false );
                        console.error( err );
                    })
                    .done( function() {
                        return clonable( true );
                    });
                }
            });
        });
    });
});

backend = angler.gitHttpBackend({
    pathToRepos: PATH_TO_REPOS,
    eventBus: eventBus,
    authenticator: function( params, cb ) {
        verifyAndGetRepoInfo( params.repoPath )
        .catch( function( err ) {
            cb({ ok: false, status: 404 });
            console.error( err );
        })
        .done( function() {
            cb({ ok: true });
        });
    }
});

// hard resets and checks out the updated HEAD after a push to a non-bare remote repo
// this can't be done inside of the post-receive hook, for some reason
eventBus.setHandler( '*', 'receive', function( repo, action, updates, done ) {
    var repoPath = path.resolve( PATH_TO_REPOS, '.' + repo ),
        git = utils.git.bind( utils, repoPath );

    git( 'reset', '--hard' )
    .then( function() {
        return git( 'checkout', ':/');
    })
    .catch( function( err ) {
        console.error( err );
    })
    .done( function() {
        done();
    });
});

app.use( compression() );
app.use( '/repos', backend );
app.use( '/hooks', githookEndpoint );

// invoked from the "go" script in client repo
app.use( '/go', function( req, res ) {
    if ( !req.headers['x-gitstream-repo'] ) {
        res.writeHead(400);
        return res.end();
    }

    var remoteUrl = req.headers['x-gitstream-repo'],
        repo = remoteUrl.substring( remoteUrl.indexOf( gitHTTPMount ) + gitHTTPMount.length );
    verifyAndGetRepoInfo( repo )
    .catch( function() {
        res.writeHead( 403 );
        res.end();
    })
    .done( function( repoInfo )  {
        var repoPath = path.join( PATH_TO_REPOS, repo );

        rcon.publish( repoInfo.userId + ':go', repoInfo.exerciseName, logErr );

        utils.getInitialCommit( repoPath )
        .catch( function() {
            res.writeHead( 404 );
            res.end();
        })
        .done( function( initCommitSHA ) {
            var git = utils.git.bind( utils, repoPath );

            return git( 'checkout', initCommitSHA )
            .then( function() {
                return git( 'branch', '-f master' );
            })
            .then( function() {
                return git( 'checkout', 'master' );
            })
            .catch( function( err ) {
                res.writeHead( 500 );
                console.error( err );
            })
            .done( function() {
                res.end();
            });
        });
    });
});

app.use( '/user', function( req, res ) {
    var userRe = /([a-z0-9_-]{0,8})@MIT.EDU/,
        match = userRe.exec( req.headers['x-ssl-client-s-dn'] ),
        userId = ( match ? match[1] : null ) || 'demouser' + Math.round(Math.random() * 1000);
    res.writeHead( 200 );
    res.end( userId ); // haxx
});

server = app.listen( PORT );

shoe( function( stream ) {
    var events = duplexEmitter( stream ),
        exerciseMachine,
        userId,
        userKey,
        rsub = redis.createClient(),
        FIELD_EXERCISE_STATE = 'exerciseState',
        FIELD_END_TIME = 'endTime',
        FIELD_CURRENT_EXERCISE = 'currentExercise';

    stream.on( 'close', function() {
        if ( exerciseMachine ) {
            exerciseMachine.removeAllListeners();
            exerciseMachine.halt();
        }
        rsub.quit();
    });

    function createExerciseMachine( exerciseName ) {
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
            exerciseDir = path.join( PATH_TO_EXERCISES, exerciseName );
        return new ExerciseMachine( emConf, repoPaths, exerciseDir, eventBus );
    }

    /** Forward events from the exerciseMachine to the client */
    function initExerciseMachineListeners( exerciseMachine ) {
        exerciseMachine.on( 'ding', function() {
            var args = [ 'ding' ].concat( Array.prototype.slice.call( arguments ) );
            events.emit.apply( events, args );
            rcon.hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME );
        });

        exerciseMachine.on( 'step', function( newState ) {
            var args = [ 'step' ].concat( Array.prototype.slice.call( arguments ) );
            events.emit.apply( events, args );
            rcon.hset( userId, FIELD_EXERCISE_STATE, newState, logErr );
        });

        exerciseMachine.on( 'halt', function() {
            var args = [ 'halt' ].concat( Array.prototype.slice.call( arguments ) );
            events.emit.apply( events, args );
            rcon.hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME );
        });
    }

    // on connect, sync the client with the stored client state
    events.on( 'sync', function( recvUserId ) {
        userId = recvUserId;

        var userKeyPromise = user.getUserKey( userId );

        userKeyPromise.done( function( key ) { userKey = key; });

        rcon.hgetall( userId, function( err, clientState ) {
            if ( !clientState ) {
                clientState = { currentExercise: null };
                rcon.hmset( userId, clientState, logErr );
            }

            userKeyPromise.done( function( userKey ) {
                var timeRemaining = clientState[ FIELD_END_TIME ] - Date.now(),
                    exerciseState = clientState[ FIELD_EXERCISE_STATE ],
                    currentExercise = clientState[ FIELD_CURRENT_EXERCISE ];

                if ( err ) { return events.emit( 'err', err ); }

                if ( exerciseState && timeRemaining > 0 ) {
                    // there's already an excercise running. reconnect to it
                    exerciseMachine = createExerciseMachine( currentExercise );
                    exerciseMachine.init( exerciseState, timeRemaining / 1000 );

                    initExerciseMachineListeners( exerciseMachine );
                } else if ( exerciseState ) { // last exercise has expired
                    rcon.hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME );
                    delete clientState[ FIELD_EXERCISE_STATE ];
                    delete clientState[ FIELD_END_TIME ];
                }

                clientState.user = {
                    key: userKey,
                    id: userId
                };

                events.emit( 'sync', clientState );
            });
        });

        rsub.subscribe( userId + ':go' );
        rsub.on( 'message', function( channel, exerciseName ) {
            rcon.hgetall( userId, function( err, state ) {
                // only start exercise if user is on the exercise page
                if ( exerciseName !== state.currentExercise ) { return; }

                var startState;

                if ( exerciseMachine ) { exerciseMachine.halt(); }
                exerciseMachine = createExerciseMachine( exerciseName );
                exerciseMachine.init();

                startState = exerciseMachine._state;

                initExerciseMachineListeners( exerciseMachine );

                rcon.hmset( userId,
                       FIELD_EXERCISE_STATE, startState,
                       FIELD_END_TIME, exerciseMachine.endTimestamp,
                       logErr );

                state[ FIELD_EXERCISE_STATE ] = startState;
                state[ FIELD_END_TIME ] = exerciseMachine.endTimestamp;

                events.emit( 'sync', state );
            });
        });

    }.bind( this ) );

    events.on( 'exerciseChanged', function( newExercise ) {
        if ( exerciseMachine ) { // stop the old machine
            exerciseMachine.halt();
            exerciseMachine = null;
        }

        rcon.multi()
            .expire( userId, CLIENT_IDLE_TIMEOUT )
            .hdel( userId, FIELD_EXERCISE_STATE, FIELD_END_TIME )
            .hset( userId, FIELD_CURRENT_EXERCISE, newExercise )
            .exec( logErr );
    });
}).install( server, '/events' );
