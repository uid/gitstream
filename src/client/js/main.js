var shoe = require('shoe'),
    stream = shoe('http://localhost:4242/events'),
    emitter = require('duplex-emitter'),
    events = emitter( stream ),
    logger = function( prefix ) {
        return function() {
            console.log( prefix, arguments );
        }
    };

events.on('sync', logger('sync') );
events.on( 'step', logger('step') );
events.on( 'ding', logger('ding') );
events.on( 'halt', logger('halt') );
// events.emit('exerciseChanged', 'exercise1');
