'use strict'

function propIsFn( thing, prop ) {
    return thing && typeof thing[ prop ] === 'function'
}

/**
 * A Mealy machine that represents multi-step exercises as states.
 * This class is intended to be connected to an ExerciseMachine via an EventEmitter
 *
 * @param {Object} config @see ExerciseViewerConfigExample.js for configuration parameters
 * @param {EventEmitter} eventEmitter the emitter of ExerciseMachine eventEmitter
 */
function ExerciseViewer( config, eventEmitter ) {
    if ( !(this instanceof ExerciseViewer) ) {
        return new ExerciseViewer( config, eventEmitter )
    }

    var stateEntry,
        onHalt = config.onHalt || function() {},
        onDing = config.onDing || function() {}

    this._states = {}

    for ( stateEntry in config ) {
        if ( config.hasOwnProperty( stateEntry ) ) {
            this._states[ stateEntry ] = config[ stateEntry ]
        }
    }

    eventEmitter.on( 'step', function( newState, oldState, output, cb ) {
        var oldStateDef = this._states[ oldState ],
            newStateDef = this._states[ newState ],
            doneCb = ( cb || output || function() {} ).bind( null, newState, oldState )

        if ( propIsFn( oldStateDef, newState ) || propIsFn( newStateDef, 'onEnter' ) ) {
            if ( propIsFn( oldStateDef, newState ) ) {
                oldStateDef[ newState ].call( config, output, doneCb )
            }
            if ( propIsFn( newStateDef, 'onEnter' ) ) {
                newStateDef.onEnter.call( config, output, doneCb )
            }
        } else {
            doneCb()
        }
        this._currentState = newState
    }.bind( this ) )

    eventEmitter.on( 'halt', function( haltState, cb ) {
        onHalt.call( config, haltState )
        if ( cb ) { cb( haltState ) }
    }.bind( this ) )

    eventEmitter.on( 'ding', function( cb ) {
        onDing.call( config, this._currentState )
        if ( cb ) { cb( this._currentState ) }
    }.bind( this ) )
}

ExerciseViewer.prototype = {
    /** initializes the sm to a given state. idempotent */
    init: function( startState ) {
        if ( this._currentState ) { return }

        this._currentState = startState
        if ( this._states.start && typeof this._states.start[ startState ] === 'function' ) {
            this._states.start[ startState ]()
        }
    }
}

module.exports = ExerciseViewer
