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

  // tests that events are correctly registered as listeners and transition to next states
  // arguments passed to the stepping function should be those generated by the eventbus
  // `this` in a transition fn should be the exercise utils
  it('testEventedStepFn', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {
        onCommit: function(repo, action, info, done) {
          assert.strictEqual( repo, '/nhynes/test.git' )
          assert.strictEqual( action, 'commit' )
          assert( info.test )
          assert( this.fileExists )
          done('nextState')
        }
      },
      nextState: null
    }, repoPaths, exerciseDir, eventBus )

    em.on( 'halt', (haltState) => {
      assert.strictEqual( haltState, 'nextState' )
    })

    em.init()

    eventBus.trigger(repo, 'commit', [ { test: true } ] )
  })


  // same as above but for handlers
  it('testEventedStepHandler', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {
          handleCommit: function( repo, action, info, done ) {
              assert.strictEqual( repo, '/nhynes/test.git' )
              assert.strictEqual( action, 'commit' )
              assert( info.test )
              assert( this.fileExists )
              done('nextState')
          }
        },
      nextState: null
      }, repoPaths, exerciseDir, eventBus )

    em.on( 'halt', function( haltState ) {
      assert.strictEqual( haltState, 'nextState' )
    })

    em.init()

    eventBus.trigger( repo, 'commit', [ { test: true } ] )
  })


  it('testEventedStepString', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {
          onCommit: 'nextState'
        },
      nextState: null
      }, repoPaths, exerciseDir, eventBus )

    em.on( 'halt', function( haltState ) {
      assert.strictEqual( haltState, 'nextState' )
    })

    em.init()

    eventBus.trigger( repo, 'commit', [ { test: true } ] )
  })


  // verifies that ExerciseMachine does not simply call properties that match on[A-Z][a-z]+
  it('testEventedStepIgnoreExtraneousOn', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {
          onSomeNonGitEvent: 'nextState'
      },
      nextState: null
      }, repoPaths, exerciseDir, eventBus ).init()

    eventBus.triggerListeners( repo, 'some-non-git-event' )

    assert.strictEqual( em._state, 'test' )
  })

  // tests that listeners from the old state are removed
  it('testTeardown', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      test: {
          onPush: 'badState',
          onCommit: 'nextState'
      },
      nextState: {
          onCommit: 'goodState'
      },
      badState: null,
      goodState: null
      }, repoPaths, exerciseDir, eventBus ).init()

    eventBus.triggerListeners( repo, 'commit' )
    eventBus.triggerListeners( repo, 'push' )
    eventBus.triggerListeners( repo, 'commit' )
    assert.strictEqual( em._state, 'goodState' )
  })

  // tests that the ding/timer done event is called when passed a timeLimit in the config
  it('testDingConfig', function (){
    const em = new ExerciseMachine({
      startState: 'test',
      timeLimit: 0.1, // seconds
      test: {}
      }, repoPaths, exerciseDir, eventBus )

    let failTimeout = setTimeout( function() {
      assert( false )
    }, 111 )

    em.init()
    assert( Math.abs( em.endTime - ( Date.now() + 0.1 * 1000 ) ) <= 1 )

    em.on( 'ding', function() {
      clearTimeout( failTimeout )
      assert( true )
    })
  })


  // tests that the ding/timer done event is called when passed a timeLimit in init
  it('testDingInit', function (){
    const em = new ExerciseMachine({
      timeLimit: 0.2, // seconds
      test: {}
    }, repoPaths, exerciseDir, eventBus )

    let failTimeout = setTimeout( function() {
      assert( false )
    }, 111 )

    em.init( 'test', 0.1 )
    assert( Math.abs( em.endTime - ( Date.now() + 0.1 * 1000 ) ) <= 1 )

    em.on( 'ding', function() {
      clearTimeout( failTimeout )
      assert( true )
    })
  })
})


/**
it('', function (){
})
*/

