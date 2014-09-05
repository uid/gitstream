var angler = require('git-angler'),
    compression = require('compression'),
    connect = require('connect'),
    dnode = require('dnode'),
    net = require('net'),
    serveStatic = require('serve-static'),
    shoe = require('shoe'),
    app = connect(),
    server,
    eventBus = new angler.EventBus(),
    anglerOpts = { pathToRepos: '/srv/repos', eventBus: eventBus },
    backend = angler.gitHttpBackend( anglerOpts ),
    githookEndpoint = angler.githookEndpoint( anglerOpts ),
    eventBusRPCs,
    PORT = 4242;

app.use( compression() );
app.use( '/repos', backend );
app.use( '/hooks', githookEndpoint );
app.use( serveStatic( __dirname + '/../client/') ); // TODO: put node behind nginx

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
