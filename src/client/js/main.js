'use strict';

var shoe = require('shoe'),
    $ = require('zeptojs'),
    _ = require('lodash'),
    stream = shoe('http://localhost:4242/events'),
    streamEmitter = require('duplex-emitter'),
    eventEmitter = require('event-emitter'),
    ExerciseViewer = require('./ExerciseViewer'),
    events = streamEmitter( stream ),
    exerciseEvents = eventEmitter({}),
    triggerExerciseEvent = function( eventName, helperFn ) {
        return function() {
            var args = Array.prototype.slice.call( arguments );
            exerciseEvents.emit.apply( exerciseEvents, [ eventName ].concat( args ) );
            if ( helperFn ) { helperFn(); }
        };
    },
    state = {},
    userKey,
    userId = window.location.hash.substring( 1 ),

    createPushNewFileConf = require('../exercises/createPushNewFile'),
    editFileConf = require('../exercises/editFile'),
    mergeConflictConf = require('../exercises/mergeConflict'),
    moment = require('moment'),

    timerInt;

$(document.body).prepend('<pre style="color:blue;font-size:110%">git clone http://128.30.9.243:4242/repos/' + userId + '/000000-' + window.exercise + '.git ' + window.exercise + '</pre>' );

events.emit('exerciseChanged', window.exercise );
events.emit('sync', { userId: userId });

events.on('sync', function( newState ) {
    clearInterval( timerInt );
    require('event-emitter/all-off')( exerciseEvents );

    state = _.defaults( state, newState );
    userKey = newState.key || userKey;

    var exerciseConf,
        exerciseViewer,
        updateTimer;

    if ( newState.exerciseState ) {
        if ( window.exercise === 'createPushNewFile' ) {
            exerciseConf = createPushNewFileConf();
        } else if ( window.exercise === 'editFile' ) {
            exerciseConf = editFileConf();
        } else {
            exerciseConf = mergeConflictConf();
        }

        exerciseEvents = eventEmitter({});
        $('#statusMessages').html('');
        exerciseViewer = new ExerciseViewer( exerciseConf, exerciseEvents );
        exerciseViewer.init( newState.exerciseState );

        updateTimer = function() {
            var timeRemaining = moment.duration( newState.endTime - Date.now() + 1000 );
            if ( timeRemaining >= 0 ) {
                $('#countdown').toggleClass('runningout', timeRemaining <= 6000 );
                $('#timer').html( timeRemaining.minutes() + ':' +
                                 ( timeRemaining.seconds() < 10 ? '0' : '' ) +
                                 timeRemaining.seconds() );
            } else {
                clearInterval( timerInt );
            }
        };
        updateTimer();
        timerInt = setInterval( updateTimer, 1000 );
    }
});

// forward exercise events to exercise machine emitter
events.on( 'step', triggerExerciseEvent('step') );
events.on( 'halt', triggerExerciseEvent('halt', function() {
    clearInterval( timerInt );
}) );
events.on( 'ding', triggerExerciseEvent('ding'), function() {
    $('#timer').html('0:00');
} );
