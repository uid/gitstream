'use strict';

var EVENTS_ENDPOINT = '/events',
    shoe = require('shoe'),
    $ = require('zeptojs'),
    _ = require('lodash'),
    hmac = require('crypto-js/hmac-sha1'),
    eventEmitter = require('event-emitter'),
    exercises = require('gitstream-exercises'),
    ExerciseViewer = require('./ExerciseViewer'),
    events = require('duplex-emitter')( shoe( EVENTS_ENDPOINT ) ),
    exerciseEvents = eventEmitter({}),
    radio = eventEmitter({}),
    triggerExerciseEvent = function( eventName, helperFn ) {
        return function() {
            var args = Array.prototype.slice.call( arguments ),
                helper = helperFn && typeof helperFn === 'function' ? helperFn : function() {};
            exerciseEvents.emit.apply( exerciseEvents, [ eventName ].concat( args, helperFn ) );
        };
    },

    exerciseTmp = require('../templates/exercise.hbs'),
    indexTmp = require('../templates/index.hbs'),

    state = {};

function renderExerciseView( exerciseName, conf, user ) {
    var stepIndex = 1,
        steps = _.map( conf.steps, function( stateDesc, stateName ) {
            return {
                name: stateName,
                desc: stateDesc
            };
        }),
        mac = hmac( user.id + exerciseName, user.key ).toString().substring( 0, 6 ),
        cloneUrl = window.location.protocol + '//' + window.location.host + '/repos/' +
            user.id + '/' + mac + '-' + exerciseName + '.git',
        templateParams = {
            title: conf.title,
            cloneUrl: cloneUrl,
            steps: steps,
            stepIndex: function() {
                return stepIndex++;
            }
        };

    return $( exerciseTmp( templateParams ) );
}

function selectViewStep( name, scope ) {
    var scope = scope || $('.exercise-view');
    return scope.find( '[data-statename="' + name + '"]' );
}

function hashChangeExercise() {
    radio.emit( 'exerciseChanged', window.location.hash.substring(1) );
}

function changeHashSilent( newHash ) {
    $(window).off( 'hashchange', hashChangeExercise );
    window.location.hash = newHash;
    setTimeout( function() {
        $(window).on( 'hashchange', hashChangeExercise );
    }, 0 );
 }

radio.on( 'exerciseChanged', function( changeTo ) {
    var exerciseViewerConf,
        exerciseView,
        newExercise,
        silent,
        setHash;

    if ( changeTo.newExercise ) {
        newExercise = changeTo.newExercise;
        silent = changeTo.silent;
        setHash = changeTo.setHash;
    } else {
        newExercise = changeTo;
    }

    require('event-emitter/all-off')( exerciseEvents );
    exerciseEvents = eventEmitter({});

    if ( !silent ) {
        events.emit( 'exerciseChanged', newExercise );
        delete state.exerciseState;
    }

    if ( setHash ) { changeHashSilent( newExercise ); }

    if ( exercises[ newExercise ] ) {
        exerciseViewerConf = exercises[ newExercise ];
        exerciseView = renderExerciseView( newExercise, exerciseViewerConf.view, state.user );

        if ( state.exerciseState ) {
            selectViewStep( state.exerciseState, exerciseView ).addClass('focused');
        }

        ExerciseViewer( exerciseViewerConf.machine, exerciseEvents );

        $('.main-content').html( exerciseView );
    } else {
        changeHashSilent('');
        $('.main-content').html( indexTmp() );
    }

    $('.main-content').removeClass('hide');
});

$(window).on( 'hashchange', hashChangeExercise );

events.emit('sync');

events.on( 'sync', function( newState ) {
    var exerciseViewerConf,
        exerciseViewer,
        renderedView,
        hashExercise = window.location.hash.substring(1),
        prevExercise = state.currentExercise;

    state = _.defaults( newState, state );
    state.currentExercise = hashExercise ||
        ( state.currentExercise === 'null' ? null : state.currentExercise );

    radio.emit( 'exerciseChanged', {
        newExercise: state.currentExercise,
        silent: true,
        setHash: true
    });
});

// forward exercise events to exercise machine emitter
events.on( 'step', triggerExerciseEvent( 'step', function( newState, oldState, stepOutput ) {
    var newStateStepView = selectViewStep( newState ),
        oldStateStepView = selectViewStep( oldState ),
        newStateFeedback = newStateStepView.find('.feedback'),
        oldStateFeedback = oldStateStepView.find('.feedback');

    selectViewStep( oldState ).removeClass('focused issue');
    oldStateFeedback.html('');
    newStateStepView.addClass('focused');
    if ( stepOutput ) {
        newStateStepView.addClass('issue');
        newStateFeedback.html( stepOutput );
        newStateFeedback.addClass('flash');
        setTimeout( function() {
            newStateFeedback.removeClass('flash');
        }, 70 );
    }
}) );
events.on( 'halt', triggerExerciseEvent( 'halt', function( haltState ) {
    // stop the timer
}) );
events.on( 'ding', triggerExerciseEvent( 'ding', function() {
    var viewConf = exercises[ state.currentExercise ],
        renderedView = renderExerciseView( state.currentExercise, viewConf.view, state.user );

    $('.main-content').html( renderedView );
}) );
