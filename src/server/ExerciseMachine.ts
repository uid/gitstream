console.error('using exerciseMachine.ts');

import util from 'util';
import _ from 'lodash';
import { v1 as uuid } from 'node-uuid';
import { EventEmitter } from 'events';

// todo: use imports once all files are .ts
import { utils } from './utils.js'
import { exerciseUtils } from './exerciseUtils.js';

const GIT_EVENTS = utils.events2Props( [ 'on', 'handle' ],
[ 'pre-pull', 'pull', 'pre-clone', 'clone', 'pre-push', 'push', 'pre-info', 'info',
'merge', 'pre-rebase', 'pre-commit', 'commit', 'checkout', 'pre-receive', 'receive' ] )

// todo: solidify these types
type EventBus = any; // this one can be traced back to angler
type Conf = any; // review docs


/**
 * A state machine that represents multi-step exercises as states.
 *
 * This class is an extension of EventEmitter:
 *  Event `step`: (newState, oldState, data)
 *  Event `halt`: (haltState)`
 *
 */
export interface ExerciseMachineContext extends EventEmitter {
    // properties
    _repo: string;
    _state: string | undefined;
    _eventBus: EventBus;
    _exerciseUtils: any;
    _states: any;
    _currentListeners: Array<{ name: string, action: string }>;
    _currentHandlers: Array<{ action: string }>;
    halted: boolean;

    // methods
    // todo: not sure if these have to be arrow functions
     init( startState?: string): void;
    _step( newState: string | undefined, incomingData?: any): void;
    _setUp(): void;
    _tearDown(): void;
     halt(): void;
 }


/**
 * Add default values to machine.
 * 
 * @param config see `gitstream-exercises/README.md` > Configuration File Format > `machine`
 * @param repoPaths { String path: the repo short path, String fsPath: the fs path }
 * @param exercisePath the path to the exercise directory
 * @param eventBus the EventBus on which to listen for repo events
 */
function ExerciseMachine(this: ExerciseMachineContext, config: any, repoPaths: {path: string, fsPath: string}, exerciseDir: string, eventBus: EventBus): any { // todo: any
    if ( !(this instanceof ExerciseMachine) ) {
        return new (ExerciseMachine as any)(config, repoPaths, exerciseDir, eventBus ) // todo: improve type assertion
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
     * @param startState - the start state. Default: startState specified by config
     * @return the current ExerciseMachine
     */
    init: function(this: ExerciseMachineContext, startState: string ) {
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
     * @param state - the state into which to step
     */
    _step: function(this: ExerciseMachineContext, newState: string | undefined, incomingData?:any): void {
        if ( newState === undefined ) { return }

        const oldState = this._state,
            newStateConf = this._states[ newState ]
        
        let entryPoint;

        const stepDone = ( stepTo: string, stepData?: any ) => { // todo: any, not sure if stepData should be optional
                const emitData = { prev: incomingData, new: stepData }
                this.emit( 'step', newState, oldState, emitData )
                if ( stepTo !== undefined ) { this._step( stepTo ) }
                this._setUp()
            }

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

        if ( this._state !== undefined && newStateConf === undefined ) {
            throw Error('No definition for state: ' + newState + '. Prev state: ' + oldState )
        }

        entryPoint = typeof newStateConf !== 'object' ? newStateConf :
            ( newStateConf.onEnter ? newStateConf.onEnter : function( done: () => void ) { done() } ) // todo: weird type on done

        if ( typeof entryPoint === 'function' ) {
            entryPoint.call( this._exerciseUtils, stepDone )
        } else {
            stepDone( entryPoint )
        }
    },

    /**
     * Sets up the current state
     */
    _setUp: function(this: ExerciseMachineContext) {
        const stateConfig = this._states[ this._state as string], // todo:fix
            transitionDone = ( stepTo: any, data?: any ) => { // todo: any. also not sure if setting data as optional is ok
                this._step( stepTo, data )
            }

        _.map( stateConfig, ( transition: any, transitionEvent: any ) => { // todo: any
            let gitEventName = GIT_EVENTS[ transitionEvent ],
                uniqName,
                registerFn
            if ( !gitEventName ) { return }

            if ( transitionEvent.indexOf('handle') === 0 ) {
                registerFn = this._eventBus.setHandler.bind( this._eventBus )
                this._currentHandlers.push({ action: gitEventName })
            } else {
                uniqName = uuid()
                registerFn = this._eventBus.addListener.bind( this._eventBus, uniqName )
                this._currentListeners.push({ name: uniqName, action: gitEventName })
            }

            registerFn( this._repo, gitEventName, (...listenerArgs: any) => {
                if ( typeof transition === 'function' ) {
                    transition.apply( this._exerciseUtils, listenerArgs.concat( transitionDone ) )
                } else {
                    // transition contains the name of the next state
                    transitionDone( transition )
                }
            })
        })
    },

    /**
     * Tears down the current state
     */
    _tearDown: function(this: ExerciseMachineContext) {
        this._currentListeners.map( ( listener: { name: string; action: string; } ) => {
            this._eventBus.removeListener( listener.name, this._repo, listener.action )
        })
        this._currentHandlers.map( ( handler: { action: string; } ) => {
            this._eventBus.setHandler( this._repo, handler.action, undefined )
        } )
        this._currentListeners = [];
        this._currentHandlers = [];
    },

    /**
     * Forcibly halts this ExerciseMachine
     */
    halt: function(this: ExerciseMachineContext) {
        this._step( undefined );
    }
})

export { ExerciseMachine };