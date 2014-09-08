var angler = require('git-angler'),
    compression = require('compression'),
    connect = require('connect'),
    dnode = require('dnode'),
    path = require('path'),
    shoe = require('shoe'),
    spawn = require('child_process').spawn,
    user = require('./user')({
        sqlHost: 'localhost', sqlUser: 'nhynes', sqlPass: 'localdev', sqlDb: 'gitstream'
    }),
    app = connect(),
    server,
    eventBus = new angler.EventBus(),
    PATH_TO_REPOS = '/srv/repos',
    backend,
    githookEndpoint = angler.githookEndpoint({ pathToRepos: PATH_TO_REPOS, eventBus: eventBus }),
    PORT = 4242;

/**
 * Verifies the MAC provided in a repo's path (ex. /username/beef42-exercise2.git)
 * @param {String|Array} repoPath a path string or an array of path components
 * @param {Function} cb errback that receives a boolean representing the verification status
 */
function verifyRepoMac( repoPath, cb ) {
    var splitRepoPath = ( repoPath instanceof Array ? repoPath : repoPath.split('/').slice( 1 ) ),
        repoNameData,
        userId,
        repoMac,
        macMsg;

    if ( splitRepoPath.length < 2 ) {
        cb( false );
        return;
    }

    repoNameData = splitRepoPath[ splitRepoPath.length - 1 ].split('-');
    userId = splitRepoPath[ splitRepoPath.length - 2 ];
    repoMac = repoNameData[0];
    macMsg = userId + repoNameData.slice( 1 ).join('');

    user.verifyMac( userId, repoMac, macMsg, cb );
}

eventBus.setHandler( '*', '404', function( scope, _, data, cb ) {
    if ( !/exercise[1-9][0-9]*\.git$/.test( scope ) ) { return cb( false ); }

    verifyRepoMac( scope, function( err, ok ) {
        var pathToRepo,
            exerciseRepo,
            pathToStarterRepo,
            mkdir,
            cp;

        if ( err || !ok ) {
            cb( false );
        } else {
            exerciseRepo = scope.split('/').pop().split('-').pop(); // exerciseX.git
            pathToRepo = path.join( PATH_TO_REPOS, scope );
            pathToStarterRepo = path.join( PATH_TO_REPOS, '/starting', exerciseRepo );

            mkdir = spawn( 'mkdir', [ '-p', path.dirname( pathToRepo ) ] );
            mkdir.on( 'close', function() {
                cp = spawn( 'cp', [ '-r', pathToStarterRepo, pathToRepo ] );
                cp.on( 'close', function( code ) {
                    cb( code === 0 );
                });
            });
        }
    });
});

backend = angler.gitHttpBackend({
    pathToRepos: PATH_TO_REPOS,
    eventBus: eventBus,
    authenticator: function( params, cb ) {
        verifyRepoMac( params.repoPath, function( err, ok ) {
            cb( err ? { ok: false, status: 500 } : { ok: ok } );
        });
    }
});

app.use( compression() );
app.use( '/repos', backend );
app.use( '/hooks', githookEndpoint );

app.use( '/auth', function( req, res ) {
    var userId = 'nhynes'; // replace with ssl_client_s_*

    user.getUserKey( userId, function( err, key ) {
        if ( err ) {
            res.writeHead( 500 );
            res.end();
            return;
        }

        res.end( JSON.stringify({ key: key }) );
    });
});

server = app.listen( PORT );
shoe( function( stream ) {
    var uid = stream.id,
        eventRPCs,
        listeners = {},
        d;

    eventRPCs = {
        addListener: function( name, scope, event, callback, done ) {
            verifyRepoMac( scope, function( err, ok ) {
                if ( !err && ok ) {
                    var uniqName = uid + ':' + name;
                    listeners[ uniqName ] = listeners[ uniqName ] || [];
                    listeners[ uniqName ].push({ scope: scope, event: event });
                    eventBus.addListener( uid + ':' + name, scope, event, callback );
                }

                if ( done && done.call ) { done( !err && !!ok ); } // false && undef === undef (?!)
            });
        },
        removeListener: function( name, scope, event, done ) {
            verifyRepoMac( scope, function() {
                var uniqName = uid + ':' + name,
                    removed;
                listeners[ uniqName ] = ( listeners[ uniqName] || [] )
                    .filter( function( listener ) {
                        return !( listener.scope === scope && listener.event === event );
                    });
                removed = eventBus.removeListener( uid + ':' + name, scope, event );

                if ( done && done.call ) { done(); }
            });
        }
    };

    stream.on( 'close', function() {
        var listener,
            removeListeners = function( listener ) {
                eventBus.removeListener( listenerName, listener.scope, listener.event );
            },
            listenerName;
        for ( listenerName in listeners ) {
            listener = listeners[ listenerName ].map( removeListeners );
        }
    });

    d = dnode( eventRPCs );
    d.pipe( stream ).pipe( d );
}).install( server, '/events' );
