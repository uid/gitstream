import assert from 'assert'
import EventBus from '../lib/EventBus.js'

describe('EventBus', function() {

  let bus = null
  const testArgs = [ 'arg1', 'arg2', 'arg3' ];


  before(function () {
    bus = EventBus();
  })

  it('testHandlerScopedSingleEvent', function (){
    const expected = [ 'scope', 'event' ].concat( testArgs );

    bus.setHandler( 'scope', 'event', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), expected );
    });

    bus.setHandler( 'other_scope', '*', function() {});
    bus.setHandler( 'other_scope', 'event', function() {});

    let triggered = bus.triggerHandler( 'scope', 'event', testArgs );
    assert( triggered );

    bus.triggerHandler( 'other_scope', 'event', testArgs );

    triggered = bus.triggerHandler( 'no', 'handler', testArgs );
    assert( !triggered );
  })
})
