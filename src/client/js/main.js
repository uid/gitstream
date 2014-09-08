var shoe = require('shoe'),
    dnode = require('dnode'),
    stream = shoe('http://localhost:4242/events'),
    dcon,
    logger = function() {
        'use strict';
        console.log( arguments );
    };

dcon = dnode();
dcon.on( 'remote', function (remote) {
    'use strict';
    remote.addListener( 'name', '/nhynes/075e0b4-exercise2.git', '*', logger, logger );
});
dcon.pipe(stream).pipe(dcon);
