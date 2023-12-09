'use strict'

// Configs for imports
const EVENTS_ENDPOINT = '/events';

// Imports -- EXTERNAL
const shoe = require('shoe'),
    $ = require('zeptojs'),
    _ = require('lodash'), // todo: replace? source: https://youmightnotneed.com/lodash
    hmac = require('crypto-js/hmac-sha1'),
    eventEmitter = require('event-emitter'),
    events = require('duplex-emitter')( shoe( EVENTS_ENDPOINT ) ); // client <-> server communication

// Imports -- INTERNAL
const exercises = require('gitstream-exercises/viewers'),
    ExerciseViewer = require('./ExerciseViewer'),
    exerciseTmp = require('../templates/exercise.hbs'),
    indexTmp = require('../templates/index.hbs');

// Global variables -- CONSTNAT
const EVENTS = {
    sync: 'sync',
    exerciseDone: 'exerciseDone',
    exerciseChanged: 'exerciseChanged',
    step: 'step',
    ding: 'ding',
    halt: 'halt'
}

// Global variables -- DYNAMIC

var exerciseEvents = eventEmitter({}), // internal client communication, with ExerciseViewer
    radio = eventEmitter({}), // internal client communication, within this file only
    state = {},
    timer,
    viewer 

// ========= Start of WS =========
const WS_DEBUG = true //todo: remove or place elsewhere

/**
 * Handle WebSocket debugging logs
 * 
 * @param {string} output 
 */
function ws_log(output){
    const trueOutput = `\n[WS Debug][Client] ${output}\n`
    if(WS_DEBUG) console.log(trueOutput);
}

const EVENTS_ENDPOINT_WS = '/events_ws';

// URL must be absolute
const ws_url = (document.location.protocol == 'https:' ? 'wss://' : 'ws://')
    + document.location.host
    + EVENTS_ENDPOINT_WS;

const events_WS = new WebSocket(ws_url);

var msgs = [] // while awaiting for connection to establish. todo: in a cleaner way?

/**
 * Sends messages via WebSocket. Quues messages if connection not yet established.
 * 
 * @param {string} msgEvent
 * @param {any} msgData
 */
function sendMessage(msgEvent, msgData) {
    const rawMsg = JSON.stringify({event: msgEvent, data: msgData});

    if (events_WS.readyState !== 1) { // connection not ready
        msgs.push(rawMsg);
    } else {
        events_WS.send(rawMsg);
    }
}

events_WS.onopen = function(event) {
    if (WS_DEBUG) sendMessage('ws', 'Hi from Client!');

    while (msgs.length > 0) {
        ws_log("Waiting for WS connection...");
        sendMessage(msgs.pop());
    }

};

events_WS.onmessage = function(event) {
    const msg = JSON.parse(event.data);
    const eventType = msg.event;
    const eventData = msg.data;

    ws_log(JSON.stringify(msg));

    switch (eventType) {
        case EVENTS.sync:
            // todo
        break;
        
        case EVENTS.exerciseDone:
            // todo
        break;

        case EVENTS.exerciseChanged:
            // todo
        break;

        case EVENTS.step:
            // todo
        break;

        case EVENTS.ding:
            // todo
        break;

        case EVENTS.halt:
            // todo
        break;
     
        case 'ws': // Special case to output info about socket connection
            console.log('ws message received:', msg)
        break;
        
        default:
            console.error("error: unknown event.");
    }
};

events_WS.onclose = (event) => {
    console.log('WS connection closed:', event.reason);
};

events_WS.onerror = (event) => {
    console.error('WS Error:', event);
};

// ========= End of WS =========

$.get( '/user', function( userId ) {
    if (!userId) {
        document.location = "/login" + document.location.search;
    } else {
        sendMessage(EVENTS.sync, userId);
        events.emit(EVENTS.sync, userId); // todo: remove once WS refactoring done
    }
})


/**
 * @param {typeof EVENTS} eventType the type of event (step, halt, ding)
 * @param {Function} done the function to call when the transition has completed
 */
function triggerExerciseEvent( eventType, done ) {
    return function() {
        var args = Array.prototype.slice.call( arguments )
        exerciseEvents.emit.apply( exerciseEvents, [ eventType ].concat( args, done ) )
    }
}

function toTimeStr( msec ) {
    if ( msec === Infinity ) {
        return '&infin;'
    }

    var LAG_COMPENSATION = 400,
        MSEC_IN_MIN = 60 * 1000,
        SEC_IN_MSEC = 1000,
        minutesStr = Math.floor( ( msec + LAG_COMPENSATION ) / MSEC_IN_MIN ),
        secondsRemaining = Math.round( ( msec + LAG_COMPENSATION ) % MSEC_IN_MIN / SEC_IN_MSEC ),
        secondsStr = ( secondsRemaining < 10 ? '0' : '' ) + secondsRemaining

    return minutesStr + ':' + secondsStr
}

function Timer() {}

Timer.prototype = {
    _update: function() {
        if ( this.timeRemaining === 0 ) {
            return this.ding()
        }

        if ( this.timeRemaining <= 10 * 1000 ) {
            this._timer.addClass('stress')
        }

        this._timer.html( toTimeStr( Math.max( this.timeRemaining, 0 ) ) )
        this.timeRemaining = Math.max( this.timeRemaining - 1000, 0 )
    },
    start: function( timeRemaining ) {
        this._stopped = false
        this._timer = $('.timer')
        this.timeRemaining = timeRemaining || Infinity
        this._update()
        if ( this.timeRemaining < Infinity ) {
            this.timerInterval = setInterval( this._update.bind( this ), 1000 )
        }
        this._timer.addClass('active')
    },
    /** actually stops the timer */
    _stop: function() {
        this._stopped = true
        clearInterval( this.timerInterval )
    },
    /** these two stop the timer and add the appropriate styles */
    stop: function() {
        if ( !this._stopped ) {
            this._stop()
            this._timer.removeClass('active').addClass('stopped')
        }
    },
    ding: function() {
        this._stop()
        this._timer.html('0:00').addClass('stress').addClass('dinged')
    }
}

function renderExerciseView( exerciseName, conf, user ) {
    var stepIndex = 1,
        steps = _.map( conf.steps, function( stateDesc, stateName ) {
            return {
                name: stateName,
                desc: stateDesc
            }
        }),
        mac = hmac( user.id + exerciseName, user.key ).toString().substring( 0, 6 ),
        cloneUrl = 'http://' + window.location.host + '/repos/' +
            user.id + '/' + mac + '/' + exerciseName + '.git',
        templateParams = {
            title: conf.title,
            cloneUrl: cloneUrl,
            steps: steps,
            stepIndex: function() {
                return stepIndex++
            },
            timeLimit: toTimeStr( conf.timeLimit * 1000 ), // sec -> msec
            exerciseName: exerciseName
        },
        $rendered = $( exerciseTmp( templateParams ) )

    if ( conf.timeLimit === undefined || conf.timeLimit === Infinity ) {
        $rendered.find('.timer-wrap').css('display', 'none')
    }

    return $rendered
}

function selectViewStep( name ) {
    return $('.exercise-view').find( '[data-statename="' + name + '"]' )
}

// function changeExercise() {
//     radio.emit( 'exerciseChanged', window.location.search.substring(1) )
// }

// function changeHashSilent( newHash ) {
//     $(window).off( 'hashchange', changeExercise )
//     window.location.search = newHash
//     setTimeout( function() {
//         $(window).on( 'hashchange', changeExercise )
//     }, 0 )
// }

radio.on( 'exerciseChanged', function( changeTo ) {
    var exerciseViewerConf,
        exerciseView,
        newExercise,
        silent,
        setHash

    if ( changeTo.newExercise ) {
        newExercise = changeTo.newExercise
        silent = changeTo.silent
        setHash = changeTo.setHash
    } else {
        newExercise = changeTo
    }

    require('event-emitter/all-off')( exerciseEvents )
    exerciseEvents = eventEmitter({})

    if ( !silent ) {
        events.emit(EVENTS.exerciseChanged, newExercise )
        delete state.exerciseState
    }

    // if ( setHash ) { changeHashSilent( newExercise ) }

    if ( exercises[ newExercise ] ) {
        exerciseViewerConf = exercises[ newExercise ]()
        exerciseView = renderExerciseView( newExercise, exerciseViewerConf, state.user )

        $('.main-content').html( exerciseView )

        if ( state.exerciseState ) {
            selectViewStep( state.exerciseState, exerciseView ).addClass('focused')
            timer = new Timer()
            timer.start( state.timeRemaining )
            $('.exercise-steps').toggleClass( 'focused', true )
            $('.step-number').toggleClass( 'blurred', true )
            $('.step-desc').toggleClass( 'blurred', true )
        }

        viewer = new ExerciseViewer( exerciseViewerConf.feedback, exerciseEvents )
    } else {
        // changeHashSilent('')
        $('.main-content').html( indexTmp({ desc: exercises._order.map( function( exercise ) {
            return { title: exercises[ exercise ]().title, name: exercise }
        }) }) )
    }

    $('.main-content').removeClass('hide')
})

// $(window).on( 'hashchange', changeExercise )

events.on( EVENTS.sync, function( newState ) {
    var hashExercise = window.location.search.substring(1)

    /* merge the server's state with the client state
       only overwriting if new (non-null) value, endTime,
       or timeRemaining is received */
    _.forOwn( newState, function( v, k ) {
        state[k] = ( v === 'null' || !v ? state[k] : v )
        if ( k === 'endTime' || k === 'timeRemaining' ) {
            state[k] = v
        }
    })

    radio.emit( 'exerciseChanged', {
        newExercise: hashExercise,
        silent: state.currentExercise === hashExercise || window.synchronized,
        setHash: true
    })

    setTimeout( function() { window.synchronized = true}, 0 )
})

// forward exercise events to exercise machine emitter
events.on(EVENTS.step, triggerExerciseEvent(EVENTS.step, function( newState, oldState, stepOutput ) {
    if (newState === 'done') {
        events.emit(EVENTS.exerciseDone, state.currentExercise)
    }
    var newStateStepView = selectViewStep( newState ),
        newStateFeedback = newStateStepView.find('.feedback'),
        exerciseSteps = $('.exercise-view').find('.exercise-step')

    if ( !newStateStepView.length ) { return }

    exerciseSteps.removeClass('focused issue').find('.feedback').html('')

    newStateStepView.addClass('focused')
    if ( stepOutput ) {
        if ( newState !== 'done' ) {
            newStateStepView.addClass('issue')
        }
        newStateFeedback.html( stepOutput )
        newStateFeedback.addClass('flash')
        setTimeout( function() {
            newStateFeedback.removeClass('flash')
        }, 70 )
    }
}) )

// stops timer before expiration and resets timer state
events.on( EVENTS.halt, triggerExerciseEvent( EVENTS.halt, function() {
    if ( timer ) {
        timer.stop()
    }
    state.endTime = undefined
}) )

// timer expiration: defocuses step and resets timer state
events.on( EVENTS.ding, triggerExerciseEvent( EVENTS.ding, function() {
    if ( timer ) {
        timer.ding()
    }
    $('.exercise-view').find('.exercise-step').removeClass('focused')
    state.endTime = undefined
}) )

window.resetId = function() {
    // localStorage.clear('userId')
    // window.location.reload()
}
