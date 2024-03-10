import _ from 'lodash';
import { v1 as uuidv1 } from 'uuid';
import { EventEmitter } from 'events';

import { utils } from './utils.js'
import { exerciseUtils } from './exerciseUtils.js';

const GIT_EVENTS = utils.events2Props( [ 'on', 'handle' ],
[ 'pre-pull', 'pull', 'pre-clone', 'clone', 'pre-push', 'push', 'pre-info', 'info',
'merge', 'pre-rebase', 'pre-commit', 'commit', 'checkout', 'pre-receive', 'receive' ] )

type EventBus = any; // todo: any; this can be traced back to git-angler

/**
 * A state machine that represents multi-step exercises as states.
 *
 * This class is an extension of EventEmitter:
 *  Event `step`: (newState, oldState, data)
 *  Event `halt`: (haltState)`
 *
 */
export class ExerciseMachine extends EventEmitter {
    // todo: remove starting '_'
    // todo: remove need for '!' on these (they're there because of 'this instanceof ExerciseMachine' line)
    private _repo!: string;
    _state: string | undefined;
    private _eventBus: EventBus;
    private _exerciseUtils: any;
    _states: any;
    private _currentListeners!: Array<{ name: string, action: string }>;
    private _currentHandlers!: Array<{ action: string }>;
    halted!: boolean;

    /**
     * Add default values to machine.
     * 
     * @param config see `gitstream-exercises/README.md` > Configuration File Format > `machine`
     * @param repoPaths { String path: the repo short path, String fsPath: the fs path }
     * @param exercisePath the path to the exercise directory
     * @param eventBus the EventBus on which to listen for repo events
     */
    constructor(config: any, repoPaths: {path: string, fsPath: string}, exerciseDir: string, eventBus: EventBus) { // todo: any
        super();

        // todo: is this needed?
        if ( !(this instanceof ExerciseMachine) ) {
            return new ExerciseMachine(config, repoPaths, exerciseDir, eventBus ) // todo: improve type assertion
        }

        this._repo = repoPaths.path
        this._eventBus = eventBus

        this._exerciseUtils = exerciseUtils({ repoDir: repoPaths.fsPath, exerciseDir: exerciseDir })

        this._states = config
        this._currentListeners = []
        this._currentHandlers = []
        this.halted = true
    
        // todo: instead have arrow functions in class properties?
        this.init = this.init.bind(this);
        this._step = this._step.bind(this);
        this._setUp = this._setUp.bind(this);
        this._tearDown = this._tearDown.bind(this);
        this.halt = this.halt.bind(this);
    }


    /**
     * Initializes this ExerciseMachine with the provided start state and starts the clock
     * This method is idempotent once the machine has been started
     * @param startState - the start state. Default: startState specified by config
     * @return the current ExerciseMachine
     */
    public init(startState?: string ): void {
        if ( this._state !== undefined ) { return }

        this.halted = false

        this._step( startState || this._states.startState )
    }


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
    public _step(newState: string | undefined, incomingData?:any): void {
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
    }

    /**
     * Sets up the current state
     */
    private _setUp(): void {
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
                uniqName = uuidv1()
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
    }

    /**
     * Tears down the current state
    */
    private _tearDown(): void {
        this._currentListeners.map( ( listener: { name: string; action: string; } ) => {
            this._eventBus.removeListener( listener.name, this._repo, listener.action )
        })
        this._currentHandlers.map( ( handler: { action: string; } ) => {
            this._eventBus.setHandler( this._repo, handler.action, undefined )
        } )
        this._currentListeners = [];
        this._currentHandlers = [];
    }

    /**
     * Forcibly halts this ExerciseMachine
     */
    public halt(): void {
        this._step( undefined );
    }
}