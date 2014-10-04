'use strict';

var EVENTS_ENDPOINT = '/events',
    shoe = require('shoe'),
    $ = require('zeptojs'),
    _ = require('lodash'),
    eventEmitter = require('event-emitter'),
    ExerciseViewer = require('./ExerciseViewer'),
    events = require('duplex-emitter')( shoe( EVENTS_ENDPOINT ) ),
    exerciseEvents = eventEmitter({}),
    triggerExerciseEvent = function( eventName, helperFn ) {
        return function() {
            var args = Array.prototype.slice.call( arguments );
            exerciseEvents.emit.apply( exerciseEvents, [ eventName ].concat( args ) );
            if ( helperFn ) { helperFn(); }
        };
    },

    exerciseTmp = require('../templates/exercise.hbs'),

    state = {};

$('.gitstream').on( 'click', function() {
    events.emit( 'exerciseChanged', null );
    window.location.hash = '';
});

if ( window.location.hash ) {
    events.emit( 'exerciseChanged', window.location.hash.substring(1) );
}

events.emit('sync');

events.on( 'sync', function( newState ) {
    state = _.defaults( newState, state );
    state.currentExercise = state.currentExercise === 'null' ? null : state.currentExercise;

    window.location.hash = state.currentExercise;

    // stop and reset timer

    // tear down and recreate exercise event emitter in preparation for a new exercise
    require('event-emitter/all-off')( exerciseEvents );
    exerciseEvents = eventEmitter({});
});

// forward exercise events to exercise machine emitter
events.on( 'step', triggerExerciseEvent('step') );
events.on( 'halt', triggerExerciseEvent('halt', function() {
    // stop the timer
}) );
events.on( 'ding', triggerExerciseEvent('ding'), function() {
    // stop and zero the timer
} );
