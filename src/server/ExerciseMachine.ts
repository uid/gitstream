import util from 'util';
import _ from 'lodash';
import { v1 as uuid } from 'node-uuid'; // question: what/why is v4
import { EventEmitter } from 'events';

console.error('using exerciseMachine.ts');

// todo: use imports once all files are .ts
const utils = require('./utils'),
    exerciseUtils = require('./exerciseUtils');

const GIT_EVENTS = utils.events2Props( [ 'on', 'handle' ],
[ 'pre-pull', 'pull', 'pre-clone', 'clone', 'pre-push', 'push', 'pre-info', 'info',
'merge', 'pre-rebase', 'pre-commit', 'commit', 'checkout', 'pre-receive', 'receive' ] )

type EventBus = any; // todo: this is created in the angler file

// todo: modify to work
// interface Conf {
//     global: {
//       [key: string]: any;
//     };
  
//     machine: {
//       startState: string;
//       [key: string]: any;
//     };
  
//     viewer: {
//       [key: string]: any; 
//     };
  
//     repo?: {
//       [key: string]: any;
//     };
//   }

/**
 * A state machine that represents multi-step exercises as states.
 *
 * This class is an extension of EventEmitter:
 *  Event `step`: (newState, oldState, data)
 *  Event `halt`: (haltState)`
 *
 */
class ExerciseMachine extends EventEmitter {
    // todo: remove '_'
    private _repo!: string; // type assertion
    private _state: string | undefined = undefined;
    private _eventBus: EventBus;
    private _exerciseUtils: any;
    private _states: any;
    private _currentListeners: Array<{ name: string, action: string }> = [];
    private _currentHandlers: Array<{ action: string }> = [];
    halted!: boolean;

    /**
     * Add default values to machine.
     * 
     * @param config see `gitstream-exercises/README.md` > Configuration File Format > `machine`
     * @param repoPaths { String path: the repo short path, String fsPath: the fs path }
     * @param exerciseDir the path to the exercise directory
     * @param eventBus the EventBus on which to listen for repo events
     */
    constructor(config: any, repoPaths: {path: string, fsPath: string}, exerciseDir: string, eventBus: EventBus) {
        super();

        if ( !(this instanceof ExerciseMachine) ) {
            return new ExerciseMachine(config, repoPaths, exerciseDir, eventBus)
        }
    
        this._repo = repoPaths.path;
        this._eventBus = eventBus;
    
        this._exerciseUtils = exerciseUtils({ repoDir: repoPaths.fsPath, exerciseDir: exerciseDir })
    
        this._states = config
        this.halted = true

        // already initialized as empty (above)
        // this._currentListeners;
        // this._currentHandlers;

        // todo: instead have arrow functions in class properties?
        this.init = this.init.bind(this);
        this._step = this._step.bind(this);
        this._setUp = this._setUp.bind(this);
        this.halt = this.halt.bind(this);
        this._tearDown = this._tearDown.bind(this);
    }

    /**
     * Initializes this ExerciseMachine with the provided start state and starts the clock
     * This method is idempotent once the machine has been started
     * @param startState - the start state. Default: startState specified by config
     * @return the current ExerciseMachine
     */
    init(startState: string = this._states.machine.startState): void {
        console.log('startState inside .ts', startState)
        if ( this._state !== undefined ) { return } // todo: remove?

        this.halted = false

        this._step(startState);
    }


    /**
     * Steps the ExerciseMachine into the given state and fires a corresponding event
     *  Event `step`: (newState, oldState, data)
     *  Event `halt`: (haltState)
     *
     * The `null` state is defined as the halt state. States returning `null` are also halt states
     * Further steps when halted do nothing.
     *
     * @param state the state into which to step
     * @param incomingData the data that's incoming (optional)
     */
    private _step(newState: string | undefined, incomingData?:any): void { // todo: any
        if ( newState === undefined ) { return }

        const oldState = this._state,
            newStateConf = this._states[ newState ]
        
        let entryPoint,
            stepDone = ( stepTo: string, stepData?: any ) => { // todo: any, not sure if stepData should be optional
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
            stepDone( entryPoint ) // todo: not sure how to fix
        }
    }

    /**
     * Sets up the current state
     */
    private _setUp() {
        const stateConfig = this._states[ this._state as string], // todo: fix
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
                uniqName = uuid();
                registerFn = this._eventBus.addListener.bind( this._eventBus, uniqName )
                this._currentListeners.push({ name: uniqName, action: gitEventName })
            }

            registerFn(this._repo, gitEventName, (...listenerArgs: any) => { // todo: any
                if (typeof transition === 'function') {
                    transition.apply(this._exerciseUtils, [...listenerArgs, transitionDone]);
                } else {
                    // transition contains the name of the next state
                    transitionDone(transition); // todo: not sure how to fix
                }
            });
        })
    }

    /**
     * Tears down the current state
     */
    private _tearDown() {
        this._currentListeners.map( ( listener: { name: string; action: string; } ) => {
            this._eventBus.removeListener( listener.name, this._repo, listener.action )
        })
        this._currentHandlers.map( ( handler: { action: string; } ) => {
            this._eventBus.setHandler( this._repo, handler.action, undefined )
        } )
        this._currentListeners = []
        this._currentHandlers = []
    }

    /**
     * Forcibly halts this ExerciseMachine
     */
    halt() {
        this._step( undefined )
    }
}
    
module.exports = ExerciseMachine;


// todo: not sure if needed, removed for now
util.inherits(ExerciseMachine, EventEmitter) // (EventEmitter (ExerciseMachine))