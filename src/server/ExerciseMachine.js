var util = require('util'),
    utils = require('./utils'),
    exerciseUtils = require('./exerciseUtils'),
    _ = require('lodash'),
    uuid = require('node-uuid'),
    EventEmitter = require('events').EventEmitter,
    GIT_EVENTS = utils.events2Props( 'pre-pull', 'pull', 'pre-clone', 'clone', 'pre-push', 'push',
        'pre-info', 'info', 'merge', 'pre-rebase', 'pre-commit', 'commit', 'checkout',
        'pre-receive', 'receive' );


/**
 * A Moore machine that represents multi-step exercises as states.
 *
 * This class is an EventEmitter:
 *  Event `step`: (newState, oldState, data)
 *  Event `halt`: (haltState)`
 *  If a time limit is specified, a `ding` event will be emitted when the timer runs out
 *
 * @param {Object} config @see ExerciseMachineConfigExample.js for configuration parameters
 * @param {String} repo the name of the repo (e.g. /nhynes/exercise2.git
 * @param {EventBus} eventBus the EventBus on which to listen for repo events
 * Once initialized, if a time limit is set, the end timestamp will be available as .endTimestamp
 */
function ExerciseMachine( config, repo, eventBus ) {
    if ( !config || !repo || !eventBus ) { throw Error('Missing ExerciseMachine required params'); }
    if ( !(this instanceof ExerciseMachine) ) {
        return new ExerciseMachine( config, repo, eventBus );
    }

    this._configStartState = config.startState;
    delete config.startState;
    this._timeLimit = config.timeLimit; // in seconds
    delete config.timeLimit;

    this._repo = repo;
    this._eventBus = eventBus;

    this._states = config;
    this._currentListeners = [];
    this.halted = true;
}

util.inherits( ExerciseMachine, EventEmitter );

_.extend( ExerciseMachine.prototype, {
    /**
     * Initializes this ExerciseMachine with the provided start state and starts the clock
     * This method is idempotent once the machine has been started
     * @param {String} startState the start state. Default: startState specified by config
     * @param {Number} timeLimit the exercise time limit in seconds.
     *  Default: timeLimit specified by config
     * @return {ExerciseMachine} the current ExerciseMachine
     */
    init: function( startState, timeLimit ) {
        if ( this._state !== undefined ) { return; }

        this._timeLimit = timeLimit || this._timeLimit;
        this.halted = false;
        if ( this._timeLimit ) {
            Object.defineProperty( this, 'endTimestamp', {
                value: Date.now() + this._timeLimit * 1000,
                writable: false
            });
            setTimeout( function() {
                if ( !this.halted ) {
                    this.emit('ding');
                    this.halt();
                }
            }.bind( this ), this._timeLimit * 1000 );
        }
        this._step( startState || this._configStartState );
        return this;
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
    _step: function( newState ) {
        var oldState = this._state,
            newStateConf = this._states[ newState ],
            onEnter,
            output, // output of stepping into a state
            stepTo,
            stepData;

        if ( this.halted ) { return; }

        this._tearDown();
        this._state = newState;

        if ( newState === null || newStateConf === null ) {
            this.halted = true;
            this.emit( 'step', newState, oldState );
            this.emit( 'halt', newState );
            return;
        }

        if ( this.state !== undefined && newStateConf === undefined ) {
            throw Error('No definition for state: ' + newState + '. Prev state: ' + oldState );
        }

        // if a state evaluates to a reference to another state, then go to the new state
        if ( typeof newStateConf !== 'object' ) { // i.e. string, function, or null
            stepTo = typeof newStateConf === 'function' ? newStateConf() : newStateConf;
        } else {
            onEnter = newStateConf.onEnter;
            if ( onEnter ) {
                if ( typeof onEnter === 'string' ) { return this._step( onEnter ); }

                output = onEnter.call( exerciseUtils );
                // if output is { stepTo, data }, stepTo is new state, data is output data
                // if output is null or string, step to that state
                // otherwise, output is the output data
                // very clear, right?
                if ( output.stepTo || output.stepTo === null ||
                    output === null || typeof output === 'string' ) {
                    stepTo = ( output && output.stepTo ? output.stepTo : output );
                }
                stepData = output && output.data ? output.data : output;
            }
        }

        this.emit( 'step', newState, oldState, stepData );
        if ( stepTo || stepTo === null ) { this._step( stepTo ); }
        this._setUp();
    },

    /**
     * Sets up the current state
     */
    _setUp: function() {
        var stateConfig = this._states[ this._state ];

        _.map( stateConfig, function( stateValue, stateProp) {
            var repoAction = GIT_EVENTS[ stateProp ],
                uniqName;
            if ( !repoAction ) { return; }

            uniqName = uuid.v1();
            this._eventBus.addListener( uniqName, this._repo, repoAction, function() {
                var listenerArgs = Array.prototype.slice.call( arguments ),
                    stepInto;
                // stateValue is the transition function
                if ( typeof stateValue === 'function' ) {
                    stepInto = stateValue.apply( stateConfig, listenerArgs );
                } else {
                    stepInto = stateValue;
                }
                this._step( stepInto );
            }.bind( this ) );
            this._currentListeners.push({ name: uniqName, action: repoAction });
        }.bind( this ) );
    },

    /**
     * Tears down the current state
     */
    _tearDown: function() {
        this._currentListeners.map( function( listener ) {
            this._eventBus.removeListener( listener.name, this._repo, listener.action );
        }.bind( this ) );
        this.currentListeners = [];
    },

    /**
     * Forcibly halts this ExerciseMachine
     */
    halt: function() {
        this._step( null );
    }
});

module.exports = ExerciseMachine;
