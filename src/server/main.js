var angler = require('git-angler'),
    compression = require('compression'),
    connect = require('connect'),
    dnode = require('dnode'),
    path = require('path'),
    shoe = require('shoe'),
    spawn = require('child_process').spawn,
    user = require('./user')({
        sqlHost: 'localhost', sqlUser: 'nhynes', sqlPass: 'localdev', sqlDb: 'gitblitz'
    }),
    app = connect(),
    server,
    eventBus = new angler.EventBus(),
    PATH_TO_REPOS = '/srv/repos',
    backend,
    githookEndpoint = angler.githookEndpoint({ pathToRepos: PATH_TO_REPOS, eventBus: eventBus }),
    eventBusRPCs,
    PORT = 4242;

function verifyRepoMac( repoPath, cb ) {
    var repoNameData = repoPath[ repoPath.length - 1 ].split('-'),
        userId = repoPath[ repoPath.length - 2 ],
        repoMac = repoNameData[0],
        macMsg = userId + repoNameData.slice( 1 ).join('');

    user.verifyMac( userId, repoMac, macMsg, cb );
}

eventBus.setHandler( '*', '404', function( scope, _, data, cb ) {
    if ( !/exercise[1-9][0-9]*\.git$/.test( scope ) ) { return cb( false ); }

    verifyRepoMac( scope.split('/').slice( 1 ), function( err, ok ) {
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

eventBusRPCs = {
    addListener: eventBus.addListener.bind( eventBus ),
    setHandler: eventBus.setHandler.bind( eventBus ),
    removeListener: eventBus.removeListener.bind( eventBus )
};

shoe( function( stream ) {
    var d = dnode( eventBusRPCs );
    d.pipe( stream ).pipe( d );
}).install( server, '/events' );
