'use strict'

// Imports -- EXTERNAL
const $ = require('zeptojs'),
    _ = require('lodash'), // todo: replace? source: https://youmightnotneed.com/lodash
    hmac = require('crypto-js/hmac-sha1'),
    eventEmitter = require('event-emitter')

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
    halt: 'halt'
}

const EVENTS_ENDPOINT = '/events'; // must be the same as server!

// Global variables -- DYNAMIC
var exerciseEvents = eventEmitter({}), // internal client communication, with ExerciseViewer
    radio = eventEmitter({}), // internal client communication, within this file only
    state = {},
    viewer

// ========= For Debugging =========
const WS_DEBUG = false;

const WS_TYPE = {
    STATUS: 'Status',
    SENT: 'Sent',
    RECEIVED: 'Received'
}

/**
 * Log WebSocket events to console
 * 
 * @param {typeof WS_TYPE} type of WebSocket event
 * @param {object} output any object
 * @returns nothing
 */
function ws_log(type, output){
    if (WS_DEBUG) {
        const strOutput = JSON.stringify(output);
        strOutput.replace(/\"/g, ""); // remove extra quotation marks

        const trueOutput = `\n[WS][Client][${type}] ${strOutput}\n`;
        console.log(trueOutput);
    }
}
// ========= X =========

// URL must be absolute
const ws_url = (document.location.protocol == 'https:' ? 'wss://' : 'ws://')
    + document.location.host
    + EVENTS_ENDPOINT;

const events_WS = new WebSocket(ws_url);

let msgs = []; // awaiting connection to establish

/**
 * Sends messages via WebSocket. Queues messages if connection is not yet established.
 * 
 * @param {typeof EVENTS | 'ws' | 'err'} msgEvent
 * @param {any} msgData
 */
function sendMessage(msgEvent, msgData) {
    const msg = {event: msgEvent, data: msgData};
    

    ws_log(WS_TYPE.SENT, msg);

    if (events_WS.readyState !== 1) { // (connection not ready)
        msgs.push(msg);
    } else {
        const strMsg = JSON.stringify(msg);
        events_WS.send(strMsg);
    }
}

events_WS.onopen = function(event) {
    if (WS_DEBUG) sendMessage('ws', 'Hi from Client!');

    while (msgs.length > 0) { // send queued messages
        ws_log(WS_TYPE.STATUS, "Waiting for WS connection...");

        const { event, data } = msgs.pop();
        sendMessage(event, data);
    }

};

events_WS.onmessage = function(event) {
    const msg = JSON.parse(event.data);
    const {event: msgEvent, data: msgData} = msg;


    ws_log(WS_TYPE.RECEIVED, msg);

    let eventHandler;

    switch (msgEvent) {
        case EVENTS.sync:
            handleSync(msgData);
            break;
        
        case EVENTS.exerciseDone:
            sendMessage(EVENTS.exerciseDone, state.currentExercise);
            break;

        // Forward exercise events to exercise machine emitter
        case EVENTS.step:
            eventHandler = triggerExerciseEvent(EVENTS.step, handleStepEvent);
            eventHandler(...msgData);
            break;

        // Special case to share info about socket connection
        case 'ws':
            if (WS_DEBUG)
                console.log('ws message received:', msg)
            break;

        // User changed exercise
        // todo: handleHaltEvent doesn't do anything, safe to remove?
        case EVENTS.halt:
            eventHandler = triggerExerciseEvent(EVENTS.halt, handleHaltEvent);
            eventHandler(...msgData);
            break;

        // Special case to handle errors
        case 'err':
            if (WS_DEBUG)
                console.log('err event received:', msg)
            break;

        // Edge cases
        default:
            if (WS_DEBUG)
                console.error("error: unknown event: ", msgEvent);
    }
};

events_WS.onclose = function(event) {
    if (WS_DEBUG)
        console.log('ws connection closed:', event.reason);
};

events_WS.onerror = function(event) {
    if (WS_DEBUG)
        console.error('ws connection error:', event);
};


$.get( '/user', function( userId ) {
    if (!userId) {
        document.location = "/login" + document.location.search;
    } else {
        sendMessage(EVENTS.sync, userId);
    }
})

/**
 * @param {typeof EVENTS} eventType the type of event: step, halt
 * @param {Function} done the function to call when the transition has completed
 */
function triggerExerciseEvent(eventType, done ) {
    return (...args) => exerciseEvents.emit(eventType, ...args, done);
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

// html/css edits
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
            exerciseName: exerciseName
        },
        $rendered = $( exerciseTmp( templateParams ) )

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

radio.on( EVENTS.exerciseChanged, function( changeTo ) {
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
        sendMessage(EVENTS.exerciseChanged, newExercise);

        delete state.exerciseState
    }

    // if ( setHash ) { changeHashSilent( newExercise ) }

    if ( exercises[ newExercise ] ) {
        exerciseViewerConf = exercises[ newExercise ]() // config comes directly from gitstream-exercises/exercises folder, not server
        exerciseView = renderExerciseView( newExercise, exerciseViewerConf, state.user )

        $('.main-content').html( exerciseView )

        if ( state.exerciseState ) {
            selectViewStep( state.exerciseState, exerciseView ).addClass('focused')
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

function handleSync(newState) {
    var hashExercise = window.location.search.substring(1)

    // Merge the server's state with the client's state.
    _.forOwn( newState, function( value, key ) {
        // Update state only if the value is non-null and non-falsy,
        state[key] = (value === 'null' || !value ? state[key] : value);
    })

    radio.emit( EVENTS.exerciseChanged, {
        newExercise: hashExercise,
        silent: state.currentExercise === hashExercise || window.synchronized,
        setHash: true
    })

    setTimeout( function() { window.synchronized = true}, 0 )
}


function handleStepEvent(newState, oldState, stepOutput) {
    // note: from what I can tell, we only care when newState == 'done'.
    if (newState === 'done') {
        sendMessage(EVENTS.exerciseDone, state.currentExercise);
    }
    var newStateStepView = selectViewStep( newState ),
        newStateFeedback = newStateStepView.find('.feedback'),
        exerciseSteps = $('.exercise-view').find('.exercise-step')

    if ( !newStateStepView.length ) { return }

    // here we unfocus all previous steps (hide them somewhat by turning text gray)
    exerciseSteps.removeClass('focused issue').find('.feedback').html('')

    // view next step
    newStateStepView.addClass('focused')
    if ( stepOutput ) {
        if ( newState !== 'done' ) {
            newStateStepView.addClass('issue')
        }
        newStateFeedback.html( stepOutput )

        newStateFeedback.addClass('flash') // todo: not sure what flash is, might be redundant
        setTimeout( function() {
            newStateFeedback.removeClass('flash')
        }, 70 )
    }
}

function handleHaltEvent() {
}

window.resetId = function() {
    // localStorage.clear('userId')
    // window.location.reload()
}
