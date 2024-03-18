// all things related to managing the websocket server
// -----------------------

import WebSocket, { WebSocketServer } from 'ws';

import { ExerciseMachine } from './ExerciseMachine.js';
import { logger, user, exerciseEvents, PATH_TO_REPOS, PATH_TO_EXERCISES, eventBus } from './routes.js'
import { WebSocketEvent, ConnectionType, WebSocketDebug, EventType, ErrorType } from './logger.js';
import { userMap } from './userMap.js';
import * as routesUtils from './routesUtils.js';
import { utils } from './utils.js';
import exerciseConfs from 'gitstream-exercises';
import path from 'path';
import { Server } from 'http';

enum EVENTS {
  sync = 'sync',
  exerciseDone = 'exerciseDone',
  exerciseChanged = 'exerciseChanged',
  step = 'step',
  halt = 'halt'
}

const GS_ROUTE = '/gitstream';
const EVENTS_ENDPOINT = GS_ROUTE + '/events';

const FIELD_EXERCISE_STATE = 'exerciseState',
    FIELD_CURRENT_EXERCISE = 'currentExercise';


// Custom Types and Interfaces

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

export function setupWebSocketServer(server: Server) {
  const wss = new WebSocketServer({
      server: server,
      path: EVENTS_ENDPOINT
  });

  wss.on('connection', function(ws) {
      // bug: handling multiple users from the same source (eg userId)
      new ClientConnection(ws);
  });
}
