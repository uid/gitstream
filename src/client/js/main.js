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

$.get( '/user', function( userId ) {
    events.emit( 'sync', userId );
});

function toTimeStr( msec ) {
    if ( msec === Infinity ) {
        return '&infin;';
    }
    var minutesRemaining = Math.floor( (Number(msec) + 300) / 60000 ),
        secondsRemaining = Math.round( ( msec % 60000 ) / 1000 ) % 60,
        secondsStr = ( secondsRemaining < 10 ? '0' : '' ) + secondsRemaining;

    return minutesRemaining + ':' + secondsStr;
}

function Timer() {}

Timer.prototype = {
    _update: function() {
        if ( this.timeRemaining <= 10 * 100 ) {
            this._timer.addClass('stress');
        }

        this._timer.html( toTimeStr( this.timeRemaining ) );
        this.timeRemaining = Math.max( this.timeRemaining - 1000, 0 );
    },
    start: function( endTime ) {
        this._stopped = false;
        this._timer = $('.timer');
        this.timeRemaining = endTime ? endTime - Date.now() : Infinity;
	this._update();
        if ( this.timeRemaining < Infinity ) {
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
        cloneUrl = 'http://' + window.location.host + '/repos/' +
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

events.on( 'sync', function( newState ) {
    var hashExercise = window.location.hash.substring(1);

    _.forOwn( newState, function( v, k ) {
        state[k] = ( v === 'null' || !v ? state[k] : v );
	if ( k === 'endTime' ) {
		state[k] = v;
	}
    });


    radio.emit( 'exerciseChanged', {
        newExercise: hashExercise,
        silent: state.currentExercise === hashExercise,
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
    if( timer ) timer.stop();
    state.endTime = undefined;
}) );
events.on( 'ding', triggerExerciseEvent( 'ding', function() {
    if ( tiemr ) timer.ding();
    $('.exercise-view').find('.exercise-step').removeClass('focused');
    state.endTime = undefined;
}) );
