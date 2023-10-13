import assert from 'assert'
import ExerciseMachine from '../../src/server/ExerciseMachine.js'
import { EventBus } from 'git-angler'

describe('ExcerciseMachine', function() {

  let eventBus, repoPaths, repo, exerciseDir;

  beforeEach(function () {
    eventBus = new EventBus();
    //todo: investigate where these file paths are coming from
    repoPaths = { path: '/nhynes/test.git', fsPath: '/srv/repos/nhynes/test.git' };
    repo = repoPaths.path;
    exerciseDir = '/srv/exercises/test';
  })

  // initialization using init( startState )
  it('testInitialize', function (){
    const em = new ExerciseMachine({
      startState: 'otherState',
      test: {},
      otherState: {}
      }, repoPaths, exerciseDir, eventBus)
    em.init('test')
    assert.strictEqual( em._state, 'test' )
  })

  // initialization using init()
  it('testInitializeStartState', function (){
    const em = ExerciseMachine({
      startState: 'test',
      test: {},
      otherState: {}
      }, repoPaths, exerciseDir, eventBus).init()
    assert.strictEqual( em._state, 'test' )
  })
  
  // verify that halting emits 'halt' event and that further steps do nothing
  it('testHalt', function (){
    const em = new ExerciseMachine({
      testHalt: null,
      otherState: {}
      }, repoPaths, exerciseDir, eventBus)

    em.on( 'halt', function( haltState ) {
      assert.strictEqual( haltState, 'testHalt' )
      em._step('otherState')
      assert.strictEqual( em._state, 'testHalt' )
    })

    em.init('testHalt')
  })
  

  // verify that stepping into a state emits the state as an event
  it('testStepBasic', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {},
      nextState: null
      }, repoPaths, exerciseDir, eventBus ).init()

    em.on( 'step', function( newState, oldState ) {
      assert.strictEqual( newState, 'nextState' )
      assert.strictEqual( oldState, 'test' )
    })

    em._step('nextState')
  })

  // verify that stepping into a data and state-returning state emits the appropriate data
  // and that the newly specified state is stepped into
  it('testStepDataStep', function (){
    let stepCount = 0,
    em = new ExerciseMachine({
      startState: 'test',
      test: {
          onEnter: (done) => {
            done( 'nextState', 'some data' )
          }
        },
      nextState: null
      }, repoPaths, exerciseDir, eventBus )

    em.on( 'step', function( newState, oldState, data ) {
        stepCount++
        if ( stepCount === 1 ) {
            assert.strictEqual( newState, 'test' )
            assert.strictEqual( data.new, 'some data' )
        } else if ( stepCount === 2 ) {
            assert.strictEqual( newState, 'nextState' )
        } else {
            assert( false )
        }
    })

    em.init()
    em._step('nextState')
  })

  // stepping into a state with a string value should go to the state specified by the value
  // shorthand for defining an onEnter value
  it('testStepStringForwarding', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: 'nextState',
      nextState: null
      }, repoPaths, exerciseDir, eventBus).init()

  assert.strictEqual( em._state, 'nextState' )
  })

  // stepping into a state with a funtion value should go to the state specified by the return
  // value of the function. Shorthand for defining an onEnter function
  it('testStepFunctionForwarding', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: (done) => { done('nextState') },
      nextState: null
      }, repoPaths, exerciseDir, eventBus)

    em.on('halt', ( haltState ) => {
      assert.strictEqual( haltState, 'nextState' )
    })

    em.init()
  })

  // stepping into a state with a funtion value should halt if the return value is null
  it('testStepFunctionHalting', function (){
    let stepCount = 0;
    const em = new ExerciseMachine({
      startState: 'test',
      test: () => { return null },
      nextState: null
      }, repoPaths, exerciseDir, eventBus)

    em.on( 'step', function( newState, oldState ) {
      stepCount++
      if ( stepCount === 2 ) {
        assert.strictEqual( newState, null )
        assert.strictEqual( oldState, 'test' )
      }
    })

    em.init()
  })

  // stepping into a state that defines a string for onEntry should forward to that state
  it('testStepEntryStringHalting', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {onEnter: 'nextState'},
      nextState: null
      }, repoPaths, exerciseDir, eventBus ).init()

    assert.strictEqual( em._state, 'nextState' )
  })

  // stepping into a state that defines a string-returning function  for onEntry should forward
  // to that state specified by the return value
  it('testStepEntryFunctionHalting', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {onEnter: (done) => {done(null)}},
      nextState: null
      }, repoPaths, exerciseDir, eventBus)

    em.on( 'halt', function( haltState ) {
      assert.strictEqual( haltState, 'test' )
    })
  })

  // stepping into a state that defines a non-string-returning function for onEntry should
  // not forward to any other state
  it('testStepEntryFunctionJustExecute', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {onEnter: () => {return false}},
      nextState: null
    }, repoPaths, exerciseDir, eventBus ).init()

    assert.strictEqual( em._state, 'test' )
  })

})


