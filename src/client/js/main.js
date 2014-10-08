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
            var args = Array.prototype.slice.call( arguments );
            exerciseEvents.emit.apply( exerciseEvents, [ eventName ].concat( args, helperFn ) );
        };
    },

    exerciseTmp = require('../templates/exercise.hbs'),
    indexTmp = require('../templates/index.hbs'),

    state = {},
    timer,
    viewer;

function toTimeStr( msec ) {
    if ( msec === Infinity ) {
        return '&infin;';
    }
    var minutesRemaining = Math.floor( msec / 60000 ),
        secondsRemaining = Math.round( ( msec % 60000 ) / 1000 ),
        secondsStr = ( secondsRemaining < 10 ? '0' : '' ) + secondsRemaining;

    return minutesRemaining + ':' + secondsStr;
}

function Timer() {}

Timer.prototype = {
    _update: function() {
        var secondsRemaining = Math.round( ( this.timeRemaining % 60000 ) / 1000 );

        if ( secondsRemaining <= 10 ) {
            this._timer.addClass('stress');
        }

        this._timer.html( toTimeStr( this.timeRemaining ) );
        this.timeRemaining = Math.max( this.timeRemaining - 1000, 0 );
    },
    start: function( endTime ) {
        this._stopped = false;
        this._timer = $('.timer');
        this.timeRemaining = endTime ? endTime - Date.now() : Infinity;
        if ( this.timeRemaining < Infinity ) {
            this._update();
            this.timerInterval = setInterval( this._update.bind( this ), 1000 );
        }
        this._timer.addClass('active');
    },
    _stop: function() {
        this._stopped = true;
        clearInterval( this.timerInterval );
    },
    stop: function() {
        if ( !this._stopped ) {
            this._stop();
            this._timer.removeClass('active').addClass('stopped');
        }
    },
    ding: function() {
        this._stop();
        this._timer.html('0:00').addClass('stress').addClass('dinged');
    }
};

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
            },
            initTime: toTimeStr( conf.initTime ),
            exerciseName: exerciseName
        };

    return $( exerciseTmp( templateParams ) );
}

function selectViewStep( name ) {
    return $('.exercise-view').find( '[data-statename="' + name + '"]' );
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

        $('.main-content').html( exerciseView );

        if ( state.exerciseState ) {
            selectViewStep( state.exerciseState, exerciseView ).addClass('focused');
            timer = new Timer();
            timer.start( state.endTime );
        }

        viewer = new ExerciseViewer( exerciseViewerConf.machine, exerciseEvents );
    } else {
        changeHashSilent('');
        $('.main-content').html( indexTmp() );
    }

    $('.main-content').removeClass('hide');
});

$(window).on( 'hashchange', hashChangeExercise );

events.emit('sync');

events.on( 'sync', function( newState ) {
    var hashExercise = window.location.hash.substring(1);

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
        newStateFeedback = newStateStepView.find('.feedback'),
        exerciseSteps = $('.exercise-view').find('.exercise-step');

    if ( !newStateStepView.length ) { return; }

    exerciseSteps.removeClass('focused issue').find('.feedback').html('');

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
events.on( 'halt', triggerExerciseEvent( 'halt', function() {
    timer.stop();
}) );
events.on( 'ding', triggerExerciseEvent( 'ding', function() {
    timer.ding();
    $('.exercise-view').find('.exercise-step').removeClass('focused');
}) );
