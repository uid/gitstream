/**
 * A Mealy machine that represents multi-step exercises as states.
 * This class is intended to be connected to an ExerciseMachine via an EventEmitter
 *
 * @param {Object} config @see ExerciseViewerConfigExample.js for configuration parameters
 * @param {EventEmitter} eventEmitter the emitter of ExerciseMachine eventEmitter
 * @param {Object} context data that will be passed as `this` to functions defined in config
 */
function ExerciseViewer( config, eventEmitter, context ) {
    'use strict';

    if ( !(this instanceof ExerciseViewer) ) {
        return new ExerciseViewer( config, eventEmitter, context );
    }

    var stateEntry,
        states = {},
        currentState,
        onHalt = config.onHalt || function() {},
        onDing = config.onDing || function() {},
        transitionContext = context || {};

    for ( stateEntry in config ) {
        if ( config.hasOwnProperty( stateEntry ) ) {
            states[ stateEntry ] = config[ stateEntry ];
        }
    }

    eventEmitter.on( 'step', function( newState, oldState ) {
        var oldStateDef = states[ oldState ],
            newStateDef = states[ newState ];

        if ( oldStateDef && typeof oldStateDef[ newState ] === 'function' ) {
            oldStateDef[ newState ].call( transitionContext );
        }
        if ( newStateDef && typeof newStateDef.onEnter === 'function' ) {
            newStateDef.onEnter.call( transitionContext );
        }
        currentState = newState;
    });

    eventEmitter.on( 'halt', function() {
        onHalt.call( transitionContext, currentState );
    });

    eventEmitter.on( 'ding', function() {
        onDing.call( transitionContext, currentState );
    });
}

module.exports = ExerciseViewer;
