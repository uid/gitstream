var util = require('util'),
    utils = require('./utils'),
    exerciseUtils = require('./exerciseUtils'),
    _ = require('lodash'),
    uuid = require('node-uuid'),
    EventEmitter = require('events').EventEmitter,
    GIT_EVENTS = utils.events2Props( [ 'on', 'handle' ],
        [ 'pre-pull', 'pull', 'pre-clone', 'clone', 'pre-push', 'push', 'pre-info', 'info',
        'merge', 'pre-rebase', 'pre-commit', 'commit', 'checkout', 'pre-receive', 'receive' ] )

/**
 * A state machine that represents multi-step exercises as states.
 *
 * This class is an extension of EventEmitter:
 *  Event `step`: (newState, oldState, data)
 *  Event `halt`: (haltState)`
 *
 * @param {Object} config see `gitstream-exercises/README.md` > Configuration File Format > `machine`
 * @param {String} repoPaths { String path: the repo short path, String fsPath: the fs path }
 * @param {String} exercisePath the path to the exercise directory
 * @param {EventBus} eventBus the EventBus on which to listen for repo events
 */
function ExerciseMachine( config, repoPaths, exerciseDir, eventBus ) {
    if ( !config || !repoPaths || !exerciseDir || !eventBus ) {
        throw Error('Missing required param(s)')
    }
    if ( !(this instanceof ExerciseMachine) ) {
        return new ExerciseMachine( config, repoPaths, exerciseDir, eventBus )
    }

    this._repo = repoPaths.path
    this._eventBus = eventBus

    this._exerciseUtils = exerciseUtils({ repoDir: repoPaths.fsPath, exerciseDir: exerciseDir })

    this._states = config
    this._currentListeners = []
    this._currentHandlers = []
    this.halted = true
}

util.inherits(ExerciseMachine, EventEmitter) // (EventEmitter (ExerciseMachine))

_.extend( ExerciseMachine.prototype, {
    /**
     * Initializes this ExerciseMachine with the provided start state and starts the clock
     * This method is idempotent once the machine has been started
     * @param {String} startState the start state. Default: startState specified by config
     * @return {ExerciseMachine} the current ExerciseMachine
     */
    init: function( startState ) {
        if ( this._state !== undefined ) { return }

        this.halted = false

        this._step( startState || this._states.startState )
        return this
    },

    /**
     * Steps the ExerciseMachine into the given state and fires a corresponding event
     *  Event `step`: (newState, oldState, data)
     *  Event `halt`: (haltState)
     *
     * The `null` state is defined as the halt state. States returning `null` are also halt states
     * Further steps when halted do nothing.
     *
     * @param {String} state the state into which to step
     */
    _step: function( newState, incomingData ) {
        if ( newState === undefined ) { return }

        var oldState = this._state,
            newStateConf = this._states[ newState ],
            entryPoint,
            stepDone = function( stepTo, stepData ) {
                var emitData = { prev: incomingData, new: stepData }
                this.emit( 'step', newState, oldState, emitData )
                if ( stepTo !== undefined ) { this._step( stepTo ) }
                this._setUp()
            }.bind( this )

        if ( this.halted ) { return }

        this._tearDown()
        this._state = newState

        // if newState is null (only possible via halt._step defined below) then halt exercise
        if ( newState === null || newStateConf === null ) {
            this.halted = true
            if ( newState !== null ) { this.emit( 'step', newState, oldState ) }
            this.emit( 'halt', newState !== null ? newState : oldState )
            return
        }

        if ( this.state !== undefined && newStateConf === undefined ) {
            throw Error('No definition for state: ' + newState + '. Prev state: ' + oldState )
        }

        entryPoint = typeof newStateConf !== 'object' ? newStateConf :
            ( newStateConf.onEnter ? newStateConf.onEnter : function( done ) { done() } )

        if ( typeof entryPoint === 'function' ) {
            entryPoint.call( this._exerciseUtils, stepDone )
        } else {
            stepDone( entryPoint )
        }
    },

    /**
     * Sets up the current state
     */
    _setUp: function() {
        var stateConfig = this._states[ this._state ],
            transitionDone = function( stepTo, data ) {
                this._step( stepTo, data )
            }.bind( this )

        _.map( stateConfig, function( transition, transitionEvent ) {
            var gitEventName = GIT_EVENTS[ transitionEvent ],
                uniqName,
                registerFn
            if ( !gitEventName ) { return }

            if ( transitionEvent.indexOf('handle') === 0 ) {
                registerFn = this._eventBus.setHandler.bind( this._eventBus )
                this._currentHandlers.push({ action: gitEventName })
            } else {
                uniqName = uuid.v1()
                registerFn = this._eventBus.addListener.bind( this._eventBus, uniqName )
                this._currentListeners.push({ name: uniqName, action: gitEventName })
            }

            registerFn( this._repo, gitEventName, function() {
                var listenerArgs = Array.prototype.slice.call( arguments )
                if ( typeof transition === 'function' ) {
                    transition.apply( this._exerciseUtils, listenerArgs.concat( transitionDone ) )
                } else {
                    // transition contains the name of the next state
                    transitionDone( transition )
                }
            }.bind( this ) )
        }.bind( this ) )
    },

    /**
     * Tears down the current state
     */
    _tearDown: function() {
        this._currentListeners.map( function( listener ) {
            this._eventBus.removeListener( listener.name, this._repo, listener.action )
        }.bind( this ) )
        this._currentHandlers.map( function( handler  ) {
            this._eventBus.setHandler( this._repo, handler.action, undefined )
        }.bind( this ) )
        this._currentListeners = []
        this._currentHandlers = []
    },

    /**
     * Forcibly halts this ExerciseMachine
     */
    halt: function() {
        this._step( null )
    }
})

module.exports = ExerciseMachine
