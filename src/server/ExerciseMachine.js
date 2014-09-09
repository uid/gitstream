var util = require('util'),
    utils = require('./utils'),
    _ = require('lodash'),
    uuid = require('node-uuid'),
    EventEmitter = require('events').EventEmitter,
    GIT_EVENTS = utils.events2Props( 'pre-pull', 'pull', 'pre-clone', 'clone', 'pre-push', 'push',
        'pre-info', 'info', 'merge', 'pre-rebase', 'pre-commit', 'commit', 'checkout',
        'pre-receive', 'receive' );


/**
 * A Moore machine that represents multi-step exercises as states.
 *
 * This class is an EventEmitter that emits the `stateChanged` event
 * with the arguments: ( newState, oldState ) and the `halt` event with no arguments
 *
 * @param {Object} config @see ExerciseMachineConfigExample.js for configuration parameters
 * @param {String} repo the name of the repo (e.g. /nhynes/exercise2.git
 * @param {EventBus} eventBus the EventBus on which to listen for repo events
 */
function ExerciseMachine( config, repo, eventBus ) {
    if ( !config || !repo || !eventBus ) { throw Error('Missing ExerciseMachine required params'); }
    if ( !(this instanceof ExerciseMachine) ) { return new ExerciseMachine( config ); }

    var startState = config.startState;
    delete config.startState;

    this._repo = repo;
    this._eventBus = eventBus;

    this._states = config;
    this._currentListeners = [];
    this._halted = true;

    if ( startState ) {
        this.init( startState );
    }
}

util.inherits( ExerciseMachine, EventEmitter );

_.extend( ExerciseMachine.prototype, {
    /**
     * Initializes this ExerciseMachine with the provided start state.
     * This is called automatically if `startState` is provided in the configuration.
     * This method is idempotent once the start state has been set (possibly by the constructor)
     * @param {String} startState the start state
     */
    init: function( startState ) {
        if ( this._state ) { return; }

        this._state = startState;
        this._halted = false;
        this._step( this._state );
    },

    /**
     * Steps the ExerciseMachine into the given state and fires a corresponding event
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
            onEnterResult;

        if ( this._halted ) { return; }

        this._tearDown();
        this._state = newState;
        this.emit( 'step', newState, oldState );

        if ( newState === null || newStateConf === null ) {
            this._halted = true;
            return this.emit('halt');
        }

        if ( newStateConf === undefined ) {
            throw Error('No definition for state: ' + newState + '. Prev state: ' + oldState );
        }

        // if a state evaluates to a reference to another state, then go to the new state

        if ( typeof newStateConf !== 'object' ) { // i.e. string, function, or null
            this._step( ( typeof newStateConf === 'function' ? newStateConf() : newStateConf ) );
            return;
        }

        onEnter = newStateConf.onEnter;
        if ( onEnter ) {
            if ( typeof onEnter === 'string' ) { return this._step( onEnter ); }

            onEnterResult = onEnter();
            if ( onEnterResult || onEnterResult === null ) { return this._step( onEnterResult ); }
        }

        this._setUp();
    },

    /**
     * Sets up the current state
     */
    _setUp: function() {
        var stateConfig = this._states[ this._state ],
            stateProp,
            repoAction,
            transitionFn,
            uniqName;

        for ( stateProp in stateConfig ) {
            repoAction = GIT_EVENTS[ stateProp ];
            if ( stateConfig.hasOwnProperty( stateProp ) && repoAction ) {
                uniqName = uuid.v1();
                this._eventBus.addListener( uniqName, this._repo, repoAction, function( stepInto ) {
                    var eventArgs = Array.prototype.slice.call( arguments ).slice( 1 );
                    this._step( stepInto );
                }.bind( this, stateConfig[ stateProp ] ) );
                this._currentListeners.push({ name: uniqName, action: repoAction });
            }
        }
    },

    /**
     * Tears down the current state
     */
    _tearDown: function() {
        this._currentListeners.map( function( listener ) {
            this._eventBus.removeListener( listener.name, this._repo, listener.action );
        }.bind( this ) );
        this.currentListeners = [];
    }
});

module.exports = ExerciseMachine;
