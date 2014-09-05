var $ = require('zeptojs');
var shoe = require('shoe');
var dnode = require('dnode');

    var stream = shoe('/events');

    var d = dnode();
    d.on('remote', function (remote) {
        remote.addListener('all', '*','*', function() {
            console.log( arguments );
        });
        remote.removeListener('all', '*','*');
    });
    d.pipe(stream).pipe(d);
