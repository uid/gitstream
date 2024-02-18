import ExerciseViewer from '../../client/js/ExerciseViewer.js';
import EventEmitter from 'events';
import assert from 'assert'

describe('ExerciseViewer', () => {

  let events = null;

  beforeEach(function () {
    events = new EventEmitter()
  })

  it('testInitFn', function (){
    const ev = ExerciseViewer({
      start: {
          testState: () => { assert( true )},
          notTestState: () => { assert( false )}
        }
      }, events )

    ev.init( 'testState' )
    ev.init( 'notTestState' )
  })

  it('testStepInit', function (){
    const ev = ExerciseViewer({
        testState: {
          onEnter: () => {assert(true)}
        }
    }, events )

    events.emit( 'step', 'testState', null )
  })

  it('testStepStep', function (){

    const ev = new ExerciseViewer({
      testState: {
          testState2: () => {
              assert(true)
              this.testState = 'was here'
          }
      },
      testState2: {
          onEnter: () => {
              assert(true)
              assert.strictEqual( this.testState, 'was here' )
          }
      }
    }, events )

    events.emit( 'step', 'testState', null )
    events.emit( 'step', 'testState2', 'testState' )
  })


  it('testStepHalt', function (){
    const ev = new ExerciseViewer({
      onHalt: (haltState) => {
          assert.strictEqual( haltState, 'haltsHere' )
      },
      haltsHere: {}
    }, events )

    events.emit( 'step', 'haltsHere', null )
    events.emit( 'halt', 'haltsHere' )
  })


  it('testStepDing', function (){
    const ev = new ExerciseViewer({
        onDing: (dingState) => {
            assert.strictEqual( dingState, 'levelUp' )
        },
        levelUp: {}
    }, events )

    events.emit( 'step', 'levelUp', null )
    events.emit( 'ding' )
  })


})