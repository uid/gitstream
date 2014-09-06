var shoe = require('shoe'),
    dnode = require('dnode'),
    stream = shoe('/events'),
    dcon;

dcon = dnode();
dcon.on( 'remote', function (remote) {
    'use strict';
    remote.addEventListener( '*', '*', function() { });
});
dcon.pipe(stream).pipe(dcon);
