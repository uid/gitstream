
// External Libraries
import compression from 'compression';
import { Application, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import EventEmitter from 'events';
import { spawn } from 'child_process';
import { MongoClient, Db } from 'mongodb';
import { rimraf } from 'rimraf';
import _ from 'lodash';
import * as url from 'url';

const mongodb: Promise<Db> = MongoClient.connect('mongodb://localhost/gitstream')
    .then((client: MongoClient) => client.db());

// Internal Files
import angler from 'git-angler';
import exerciseConfs from 'gitstream-exercises';
import { ExerciseMachine } from './ExerciseMachine.js';
import { CommitSpec, utils } from './utils.js';
import { createLogger, WebSocketEvent, EventType, ErrorType, UserMapOp, ConnectionType, WebSocketDebug } from './logger.js';
import { createUser } from './user.js';
import * as routesUtils from './routesUtils.js';
import { userMap } from './userMap.js';

// Configure user and logger
export const logger = createLogger(mongodb);
export const user = createUser(mongodb);

// Constant Global Variables

const __dirname = url.fileURLToPath(new URL('.', import.meta.url)); // esm way to get dirname

const PATH_TO_REPOS = '/srv/repos',
    PATH_TO_EXERCISES = __dirname + '/exercises/',
    REPO_NAME_REGEX = /\/[a-z0-9_-]+\/[a-f0-9]{6,}\/.+.git$/,
    gitHTTPMount = '/repos'; // no trailing slash

const FIELD_EXERCISE_STATE = 'exerciseState',
    FIELD_CURRENT_EXERCISE = 'currentExercise';

enum EVENTS {
    sync = 'sync',
    exerciseDone = 'exerciseDone',
    exerciseChanged = 'exerciseChanged',
    step = 'step',
    halt = 'halt'
}

const EVENTS_ENDPOINT = '/events'; // configured with nginx

const eventBus = new angler.EventBus();

const githookEndpoint = angler.githookEndpoint({
        pathToRepos: PATH_TO_REPOS,
        eventBus: eventBus,
        gitHTTPMount: gitHTTPMount
    });

const backend = angler.gitHttpBackend({
    pathToRepos: PATH_TO_REPOS,
    eventBus: eventBus,
    authenticator: function( params: { repoPath: any; }, callback: any ) { // todo: any
        verifyAndGetRepoInfo( params.repoPath )
        .then( function() {
            callback({ok: true})
        }).catch(function( err ) {
            const info = routesUtils.extractRepoInfoFromPath( params.repoPath );
            if (info) {
                logger.err( ErrorType.GIT_HTTP, info.userId, info.exerciseName, {
                    msg: err.message
                })
            }
            callback({ ok: false, status: 404 })
        })
    }
})

const exerciseEvents = new EventEmitter();

// Custom Types and Interfaces

export interface ExerciseData {
    userId: string;
    exerciseName: string;
    mac: string;
    macMsg?: string;
}

export type RepoPath = string | string[];

// todo: figure out which of these should not be optional
type ClientState = {
    [FIELD_EXERCISE_STATE]?: string;
    [FIELD_CURRENT_EXERCISE]?: string;
    user?: {
      key?: string;
      id?: string;
    };
  };

type State = ClientState; // todo: check if this is strictly true

/**
 * Verifies the MAC provided in a repo's path (ex. /username/beef42-exercise2.git)
 * @param repoPath a path string or an array of path components
 * @return promise
 */
function verifyAndGetRepoInfo(repoPath: RepoPath): Promise<ExerciseData> {
    const repoInfo = routesUtils.extractRepoInfoFromPath(repoPath);

    if (!repoInfo) {
        throw Error('Could not get repo info');
    }

    return user.verifyMac(repoInfo.userId, repoInfo.mac, repoInfo.macMsg as string)
        .then(function() {
            return repoInfo;
        });
}

/**
 * Creates a new exercise repo.
 * @param repoName - the full repo name. e.g. /nhynes/12345/exercise1.git
 * @return a promise resolved with the repo info as returned by verifyAndGetRepoInfo
 */
function createRepo(repoName: string): Promise<ExerciseData> {
    const pathToRepo = path.join( PATH_TO_REPOS, repoName );
    const pathToRepoDir = path.dirname( pathToRepo );

    let repoInfo: ExerciseData,
        pathToExercise: string,
        pathToStarterRepo: string;

    return verifyAndGetRepoInfo(repoName)
    .then(function (info) {
        repoInfo = info;
        pathToExercise = path.join(PATH_TO_EXERCISES, repoInfo.exerciseName);
        pathToStarterRepo = path.join(pathToExercise, 'starting.git');

        return rimraf(pathToRepoDir, {});
    })
    .then(function () {
        let repoUtils = {
            _: _, // todo: looks weird, change later
            resourcesPath: pathToExercise
        };
        let commits: Promise<CommitSpec[] | undefined> = new Promise(function (resolve, reject) {
            const commitsConf = exerciseConfs.repos[repoInfo.exerciseName]().commits;
            
            if (Array.isArray(commitsConf) && commitsConf.length) {
                resolve(commitsConf as CommitSpec[]);
            } else if (typeof commitsConf === 'function') {
                commitsConf.call(repoUtils, resolve);
            } else {
                resolve(undefined);
            }
        })

        return utils.mkdirp(path.dirname(pathToRepo))
            .then(function () {
                return new Promise(function (resolve, reject) {
                    spawn('cp', ['-r', pathToStarterRepo, pathToRepo])
                        .on('close', function (cpRet) {
                            if (cpRet !== 0) {
                                reject(Error('Copying exercise repo failed'));
                            } else {
                                resolve(undefined);
                            }
                        });
                });
            })
            .then(function () {
                return commits.then(function (commits) {
                    const addCommit = function (spec: CommitSpec) {
                        return utils.addCommit.bind(null, pathToRepo, pathToExercise, spec); // todo: not use bind?
                    };

                    if (commits) {
                        return commits.reduce(function (promise, commit) {
                            return promise.then(function () {
                                return addCommit(commit)();
                            });
                        }, Promise.resolve());
                    } else {
                        return utils.git(pathToRepo, 'commit', ['-m', 'Initial commit']);
                    }
                });
            })
            .then(function () {
                return repoInfo;
            });
    });
}
    
// transparently initialize exercise repos right before user clones it
eventBus.setHandler( '*', '404', function( repoName: string, _: any, data: any, clonable: any ) { // todo: any
    if ( !REPO_NAME_REGEX.test( repoName ) ) { return clonable( false ) }

    const repoInfo = routesUtils.extractRepoInfoFromPath( repoName ) as ExerciseData; // assert good
    logger.log( EventType.INIT_CLONE, repoInfo.userId, repoInfo.exerciseName )

    createRepo(repoName)
        .then(function() {
            clonable(true)
        }).catch(function(err) {
            clonable(false)
            logger.err(ErrorType.CREATE_REPO, repoInfo.userId, repoInfo.exerciseName, {
                msg: err.message
            })
        })
})

// hard resets and checks out the updated HEAD after a push to a non-bare remote repo
// this can't be done inside of the post-receive hook, for some reason
// NOTE: when Git >= 2.3.0 is in APT, look into `receive.denyCurrentBranch updateInstead`
eventBus.setHandler( '*', 'receive', function( repo: string, action: any, updates: any[], done: () => void ) { // todo: any
    const repoPath = path.resolve( PATH_TO_REPOS, '.' + repo );
    const git = utils.git.bind( utils, repoPath );
    const isPushingShadowBranch = updates.reduce( function( isbr, update ) {
            return isbr || update.name === 'refs/heads/shadowbranch'
        }, false )

    const chain = git( 'reset', '--hard' )
        .then( function() {
            return git( 'checkout', ':/')
        })

    if ( isPushingShadowBranch ) {
        chain.then( function() {
            return git( 'update-ref', 'refs/gitstream/shadowbranch refs/heads/shadowbranch' )
        })
        .then( function() {
            return git( 'update-ref', '-d refs/heads/shadowbranch' )
        })
    }

    chain.catch( function( err ) {
        const repoInfo = routesUtils.extractRepoInfoFromPath( repo ) as ExerciseData; // assert good
        logger.err( ErrorType.ON_RECEIVE, repoInfo.userId, repoInfo.exerciseName, {
            msg: err.message
        })
    })
    .done( function() {
        done()
    })
})

class ClientConnection {
    private ws: WebSocket;

    // todo: fix the use of nulls here?
    private exerciseMachine: ExerciseMachine | null;
    private userId: string;
    private userKey: string;
    private heartbeat: NodeJS.Timeout | undefined; // todo: change?

    constructor(ws: WebSocket) {
        // one client = one socket
        this.ws = ws;

        // Shared state variables
        this.exerciseMachine = null;
        this.userId = ''; // note: because of these defaults, weird stuff can happen if userID is never set somewhere
        this.userKey = '';

        // Shared socket listeners
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onerror = this.handleError.bind(this);
        this.ws.onclose = this.handleClose.bind(this);    

        // Start heartbeat with client (temporary measure to ensure connection persists)
        this.startHeartbeat();
    }

    /**
     * Pings client every 55 seconds (less than the standard Nginx connection halt of 60 seconds).
     * If no response, connection presumed dead
     */
    startHeartbeat() {
        const hb_time = 55*1000;

        this.heartbeat = setInterval(() => {
            this.ws.ping();
        }, hb_time);
    }

    /**
     * Sends messages to established client.
     * 
     * @param msgEvent
     * @param msgData the object to be transmitted
     */
    sendMessage(msgEvent: EVENTS | 'ws' | 'err', msgData: any) { // todo: any
        const msg = {event: msgEvent, data: msgData};
        const strMsg = JSON.stringify(msg);

        try {
            this.ws.send(strMsg);
            logger.ws(WebSocketEvent.SENT, msg);
        } catch (error) { // todo: more graceful error handling?
            console.error('Error sending message:', error);
        }

    }

    handleMessage(event: WebSocket.MessageEvent) {
        const event_data = event.data as string; // Type assertion

        const msg = JSON.parse(event_data);
        const {event: msgEvent, data: msgData} = msg;
        
        logger.ws(WebSocketEvent.RECEIVED, msg);

        switch (msgEvent) {
            case EVENTS.sync:
                this.handleClientSync(msgData);
                break;
            
            case EVENTS.exerciseDone:
                this.handleExerciseDone(msgData);
                break;

            case EVENTS.exerciseChanged:
                this.handleExerciseChanged(msgData);
                break;
        
            // Special case to relay info about socket connection
            case 'ws':
                logger.ws_debug(WebSocketDebug.INFO, "ws message received", msg);
                break;
            
            // Special case to handle errors
            case 'err':
                logger.ws_debug(WebSocketDebug.ERROR, "error event received", msg);
                break;

            default:
                logger.ws_debug(WebSocketDebug.ERROR, "error, unknown event", msgEvent);
        }
    }

    // per socket
    handleError(event: WebSocket.ErrorEvent) {
        console.error('ws connection error:', event);
    }
    
    // per socket
    handleClose(event: WebSocket.CloseEvent) {
        if (this.exerciseMachine) {
            this.exerciseMachine.removeAllListeners()
            this.exerciseMachine.halt()
        }

        // Stop the heartbeat when the connection is closed
        clearInterval(this.heartbeat);

        this.removeFromActiveList();
    
        logger.log(EventType.QUIT, this.userId)
    }

    // === Maintain list of active connections ===

    addToActiveList() {
        activeConnections.push(this.userId);
        logger.connections(ConnectionType.ADD, activeConnections);
    }

    removeFromActiveList() {
        activeConnections = activeConnections.filter(userId => userId !== this.userId);
        logger.connections(ConnectionType.REMOVE, activeConnections);
    }


    // ======= Shared Event Handlers =======

    /**
     * Sync the client with the stored client state
     * 
     * @param {*} recvUserId 
     */
    handleClientSync(recvUserId: string) {
        this.userId = recvUserId; // initial and sole assignment
        this.addToActiveList();

        const userKeyPromise = user.getUserKey( this.userId )
    
        userKeyPromise.then(( key ) => {
            this.userKey = key
        }).catch(( err ) => {
            logger.err(ErrorType.DB, this.userId, 'null', {msg: err.message})
        });
    
        const handleClientState = ( err: Error | null, clientState: ClientState ) => {
            if ( err ) {
                console.error(err)
    
                logger.err( ErrorType.DB, this.userId, 'null', {
                    desc: 'userMap get client state',
                    msg: err.message
                })
    
                return this.sendMessage('err', err) // todo: stringify the error?
            }

            if ( !clientState ) { // Aka user is new and we want to initialize their data

                console.error('hmset', FIELD_EXERCISE_STATE, null);
                
                const handleUnsetClientState = logger.logDbErr( this.userId, 'null', {
                    desc: 'userMap unset client state'
                })
    
                userMap.set(this.userId, FIELD_EXERCISE_STATE, "", handleUnsetClientState)
            }
    
            userKeyPromise.then( ( userKey ) => { // not used because is the same as `this.userKey`
                const exerciseState = clientState[ FIELD_EXERCISE_STATE ],
                      currentExercise = clientState[ FIELD_CURRENT_EXERCISE ]
    
                logger.log( EventType.SYNC, this.userId, currentExercise, {
                    exerciseState: exerciseState
                })
    
                if ( exerciseState) {
                    // there's already an excercise running. reconnect to it
                    console.log('user refreshed page!')
                    this.exerciseMachine = this.createExerciseMachine( currentExercise as string);
                    this.exerciseMachine.init(exerciseState);
    
                } else if ( exerciseState ) { // last exercise has expired // wait this weird, same conditional as above. todo: fix?
                    userMap.delete(this.userId, [FIELD_EXERCISE_STATE]);
    
                    delete clientState[ FIELD_EXERCISE_STATE ]
                }
                
                clientState.user = {
                    key: this.userKey,
                    id: this.userId
                }
    
                this.sendMessage(EVENTS.sync, clientState);
            })
        };
        

        userMap.getAll(this.userId, handleClientState);
    
        const processNewExercise = ( channel: any, exerciseName: string ) => { // todo: any
            logger.log( EventType.GO, this.userId, exerciseName )
    
            const handleExerciseState = ( err: Error | null, state: State ) => {
                if (err){
                    console.log('err', err)
                    return
                }

                let startState;
                
                console.error('hgetall', this.userId, state);
    
                // only start exercise if user is on the exercise page
                if (exerciseName !== state.currentExercise) return
                if (this.exerciseMachine) {
                    this.exerciseMachine.halt()
                }
                this.exerciseMachine = this.createExerciseMachine( exerciseName )
                startState = this.exerciseMachine._states.startState;
                // set by EM during init, but init sends events. TODO: should probably be fixed
    
                console.error('hmset', FIELD_EXERCISE_STATE, startState);
                
                const handleError = ( err: Error | null) => {
                    if ( err ) {
                        // LOGGING
                        logger.err( ErrorType.DB, this.userId, exerciseName, {
                            desc: 'userMap go',
                            msg: err.message
                        })
                    }
                }
                userMap.set(this.userId, FIELD_EXERCISE_STATE, startState, handleError);
    
                state[ FIELD_EXERCISE_STATE ] = startState
    
                this.sendMessage(EVENTS.sync, state);
                this.exerciseMachine.init();
            }
            userMap.getAll(this.userId, handleExerciseState)
        }
    
        exerciseEvents.on(this.userId + ':go', (exerciseName) => {
            processNewExercise(null, exerciseName)
        });
    }

    // user changed exercise page
    handleExerciseChanged(newExercise: string) {

        if (this.exerciseMachine) { // stop the old machine
            this.exerciseMachine.halt()
            // aka, previous exercise progress is wiped when user change to a new one
            // todo: keep data persistent? possibly a bug tbh

            this.exerciseMachine = null
        }
    
        console.error('hset', this.userId, FIELD_CURRENT_EXERCISE, newExercise);
        
        const handleNewExercise = logger.logDbErr(this.userId, newExercise, {
            desc: 'userMap change exercise'
        })
    
        userMap.delete(this.userId, [FIELD_EXERCISE_STATE], handleNewExercise);
        userMap.set(this.userId, FIELD_CURRENT_EXERCISE, newExercise, handleNewExercise);
    
        logger.log( EventType.CHANGE_EXERCISE, this.userId, newExercise )
    }

    handleExerciseDone(doneExercise: string) {
        utils.exportToOmnivore(this.userId, doneExercise,
            logger.logDbErr( this.userId, doneExercise, { desc: 'Omnivore POST error' } ));
    }


    createExerciseMachine(exerciseName: string) {
        const emConf = exerciseConfs.machines[ exerciseName ](),
            repoMac = user.createMac( this.userKey, this.userId + exerciseName ),
            exerciseRepo = routesUtils.createRepoShortPath({
                userId: this.userId,
                exerciseName: exerciseName,
                mac: repoMac
            }),
            repoPaths = {
                fsPath: path.join( PATH_TO_REPOS, exerciseRepo ), // repo fs path
                path: exerciseRepo // repo short path
            },
            exerciseDir = path.join( PATH_TO_EXERCISES, exerciseName )
    
        let exerciseMachine = new ExerciseMachine( emConf, repoPaths, exerciseDir, eventBus );
        const unsetExercise = () => {
            userMap.delete(this.userId, [FIELD_EXERCISE_STATE]);
        }
    
        const stepHelper = (newState: any) => { // todo: any
            console.error('hset', this.userId, FIELD_EXERCISE_STATE, newState);
    
            const updateState = logger.logDbErr( this.userId, exerciseName, {
                desc: 'userMap step update exercise state',
                newState: newState
            });
    
            userMap.set(this.userId, FIELD_EXERCISE_STATE, newState, updateState);
    
        }
    
        /**
         * Called when one of these events happen: EVENTS.halt, EVENTS.step
         * (see below with registerListener and when it's called)
         * and sends said event to the browser
         *  
         * @param {*} listenerDef 
         * @returns function
         */
        const makeListenerFn = (listenerDef: any) => {
            // send message via websocket and call upon helper function

            // todo: refactor this function
            return (...args: any) => {
                this.sendMessage(listenerDef.event, args);
    
                listenerDef.helper(...args);
    
                logger.log(EventType.EM, this.userId, exerciseName, {
                        type: listenerDef.event,
                        info: args.slice( 1 )
                    }
                )
            }
        }
    
        const registerListener = (eventType: any, helper: any) => {
            exerciseMachine.on(eventType, makeListenerFn({ event: eventType, helper: helper}));
        }
    
        // set up listeners to send events to browser and update saved exercise state
        registerListener(EVENTS.halt, unsetExercise);
        registerListener(EVENTS.step, stepHelper);
    
        return exerciseMachine;
    }

}

let activeConnections: string[] = [];

function setupWebSocketServer(server: Server) {
    const wss = new WebSocketServer({
        server: server,
        path: EVENTS_ENDPOINT
    });

    wss.on('connection', function(ws) {
        // bug: handling multiple users from the same source (eg userId)
        new ClientConnection(ws);
    });
}

export async function configureApp(app: Application, server: Server) {
    // Set up WebSocket server
    setupWebSocketServer(server);

    // set up routes
    app.use( compression() );
    app.use( '/repos', backend );
    app.use( '/hooks', githookEndpoint );

    // invoked from the "go" script in client repo
    app.use( '/go', function( req, res ) {
        if ( !req.headers['x-gitstream-repo'] ) {
            res.writeHead(400)
            return res.end()
        }

        const remoteUrl = req.headers['x-gitstream-repo'] as string;
        const repo = remoteUrl.substring( remoteUrl.indexOf( gitHTTPMount ) + gitHTTPMount.length);

        createRepo( repo )
        .then( function( repoInfo ) {
            // only 1 instance of publish
            // note: this messaging system will kept for now
            const handlePublishError = logger.logDbErr( repoInfo.userId, repoInfo.exerciseName, {
                desc: 'userMap go emit'
            })

            try {
                exerciseEvents.emit(repoInfo.userId + ':go', repoInfo.exerciseName); 
            } catch (err) {
                if (err instanceof Error){
                    handlePublishError(err);
                }
            }

            res.writeHead( 200 )
            res.end()
        }).catch( function( err ) {
            res.writeHead( 403 )
            res.end()

            logger.err( ErrorType.CREATE_REPO, 'null', 'null', {
                desc: 'New repo on go',
                repo: repo,
                remoteUrl: remoteUrl,
                msg: err.message
            })
        })
    });
}
