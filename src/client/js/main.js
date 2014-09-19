'use strict';

var shoe = require('shoe'),
    _ = require('lodash'),
    stream = shoe('http://localhost:4242/events'),
    streamEmitter = require('duplex-emitter'),
    eventEmitter = require('event-emitter'),
    events = streamEmitter( stream ),
    exerciseEvents = eventEmitter({}),
    triggerExerciseEvent = function( eventName ) {
        return function() {
            exerciseEvents.emit.apply( null, [ eventName ].concat( arguments ) );
        }
    },
    state = {};

events.on('sync', function( newState ) {
    state = _.defaults( state, newState );
    console.log( state );
    // if key is received, store it
    // load exercise config
    // create new exercise machine

    events.emit('exerciseChanged', 'createPushNewFile');
});

// forward exercise events to exercise machine emitter
events.on( 'step', triggerExerciseEvent('step') );
events.on( 'step-out', triggerExerciseEvent('step-out') );
events.on( 'halt', triggerExerciseEvent('halt') );
events.on( 'ding', triggerExerciseEvent('ding') );
