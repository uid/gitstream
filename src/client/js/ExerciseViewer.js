'use strict'

function propIsFn( thing, prop ) {
    return thing && typeof thing[ prop ] === 'function'
}

/**
 * A Mealy machine that represents multi-step exercises as states.
 * This class is intended to be connected to an ExerciseMachine via an EventEmitter
 *
 * @param {Object} config see `gitstream-exercises/README.md` > Configuration File Format > `machine`
 * @param {EventEmitter} eventEmitter the emitter of ExerciseMachine eventEmitter
 */
function ExerciseViewer( config, eventEmitter ) {
    if ( !(this instanceof ExerciseViewer) ) {
        return new ExerciseViewer( config, eventEmitter )
    }
    var stateEntry,
        onDing = config.onDing || function() {}

    this._states = {}

    for ( stateEntry in config ) {
        if ( config.hasOwnProperty( stateEntry ) ) {
            this._states[ stateEntry ] = config[ stateEntry ]
        }
    }

    // note: cb stands for callback, which is `done` in triggerExerciseEvent
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
            doneCb(oldStateDef && oldStateDef[ newState ])
        }
        this._currentState = newState
    }.bind( this ) )

    eventEmitter.on( 'ding', function( cb ) { // todo: remove
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
