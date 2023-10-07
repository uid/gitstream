import assert from 'assert'
import EventBus from '../lib/EventBus.js'

describe('EventBus', function() {

  let bus = null
  const testArgs = [ 'arg1', 'arg2', 'arg3' ];


  beforeEach(function () {
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

  it('testHandlerScopedAllEvents', function (){
    let invocations = 0;

    bus.setHandler( 'scope', '*', function() {
        const expected = ( invocations === 0 ? [ 'scope', 'event1' ] : [ 'scope', 'event2' ] )
                        .concat( testArgs );
        invocations++;
        assert.deepEqual( Array.prototype.slice.call( arguments ), expected );
    });

    bus.setHandler( 'other_scope', 'event1', function() {});
    bus.setHandler( 'other_scope', '*', function() {});

    bus.triggerHandler( 'scope', 'event1', testArgs );
    bus.triggerHandler( 'scope', 'event2', testArgs );
    bus.triggerHandler( 'other_scope', 'event', testArgs );
  })

  it('testHandlerGlobalSingleEvent', function (){
    let invocations = 0;

    bus.setHandler( '*', 'event', function() {
        const expected = ( invocations === 0 ? [ 'scope1', 'event' ] : [ 'scope2', 'event' ] )
                        .concat( testArgs );
        invocations++;
        assert.deepEqual( Array.prototype.slice.call( arguments ), expected );
    });

    bus.setHandler( '*', 'other_event', function() {});
    bus.setHandler( 'scope1', '*', function() {});
    bus.setHandler( 'scope2', '*', function() {});
    bus.setHandler( 'scope1', 'event', function() {});
    bus.setHandler( 'scope2', 'event', function() {});
    bus.setHandler( 'scope1', 'other_event', function() {});
    bus.setHandler( 'scope2', 'other_event', function() {});

    bus.triggerHandler( 'scope1', 'event', testArgs );
    bus.triggerHandler( 'scope2', 'event', testArgs );
    bus.triggerHandler( 'scope1', 'other_event' );
  })

  it('testHandlerGlobalAllEvents', function (){
    bus.setHandler( '*', '*', function() {
        assert( true );
    });

    bus.setHandler( '*', 'event', function() {});
    bus.setHandler( '*', 'other_event', function() {});
    bus.setHandler( 'scope1', '*', function() {});
    bus.setHandler( 'scope2', '*', function() {});
    bus.setHandler( 'scope1', 'event', function() {});
    bus.setHandler( 'scope2', 'event', function() {});
    bus.setHandler( 'scope1', 'other_event', function() {});
    bus.setHandler( 'scope2', 'other_event', function() {});

    bus.triggerHandler( 'scope1', 'event', testArgs );
    bus.triggerHandler( 'scope2', 'event', testArgs );
    bus.triggerHandler( 'scope1', 'other_event', testArgs );
    bus.triggerHandler( 'scope2', 'other_event', testArgs );
  })

  it('testReplaceHandler', function (){
    const f = () => assert(true);
    let oldHandler;
    bus.setHandler( '*', '*', f );
    oldHandler = bus.setHandler( '*', '*', null );
    if ( oldHandler.call ) oldHandler();
  })

  it('testListenerScopedSingleEvent', function (){

    let triggered;
    const expected = [ 'scope', 'event' ].concat( testArgs );

    bus.addListener( 'l1', 'scope', 'event', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), expected );
    });
    bus.addListener( 'l2', 'scope', 'event', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), expected );
    });

    bus.addListener( 'l3', 'other_scope', 'event', function() {
        assert( false );
    });
    bus.addListener( 'l4', 'other_scope', '*', function() {
        assert( false );
    });

    triggered = bus.triggerListeners( 'scope', 'event', testArgs );
    assert( triggered );

    triggered = bus.triggerListeners( 'none', 'triggered', testArgs );
    assert( !triggered );
  })

  it('testListenerScopedAllEvents', function (){

    let invocations = 0;
    const getExpected = function() {
        return ( invocations === 0 ? [ 'scope', 'event' ] : [ 'scope', 'other_event' ] )
            .concat( testArgs );
      };

    bus.addListener( 'l1', 'scope', '*', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
    });
    bus.addListener( 'l2', 'scope', '*', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
    });
    bus.addListener( 'l3', 'scope', 'event', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
    });
    bus.addListener( 'l4', 'scope', 'event', function() {
        assert.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
    });

    bus.addListener( 'l5', 'other_scope', '*', function() {
        assert( false );
    });
    bus.addListener( 'l6', 'other_scope', 'event', function() {
        assert( false );
    });

    bus.triggerListeners( 'scope', 'event', testArgs );
    invocations++;
    bus.triggerListeners( 'scope', 'other_event', testArgs );
  })

  it('testListenerGlobalSingleEvent', function (){
    bus.addListener( 'l1', '*', 'event', function() {
        assert( true );
    });
    bus.addListener( 'l2', '*', 'event', function() {
        assert( true );
    });
    bus.addListener( 'l3', 'scope', 'event', function() {
        assert( true );
    });
    bus.addListener( 'l4', 'scope', 'event', function() {
        assert( true );
    });

    bus.addListener( 'l5', 'other_scope', 'other_event', function() {
        assert( false );
    });
    bus.addListener( 'l6', 'other_scope', 'other_event', function() {
        assert( false );
    });

    bus.triggerListeners( 'scope', 'event', testArgs );
    bus.triggerListeners( 'other_scope', 'event', testArgs );
  })

  it('testListenerGlobalAllEvents', function (){
    const pass = () => assert( true );

    bus.addListener( 'l1', '*', '*', pass );
    bus.addListener( 'l2', '*', '*', pass );

    bus.addListener( 'l3', '*', 'event', pass );
    bus.addListener( 'l4', '*', 'other_event', pass );

    bus.addListener( 'l5', 'scope', '*', pass );
    bus.addListener( 'l6', 'other_scope', '*', pass );

    bus.addListener( 'l7', 'scope', 'event', pass );
    bus.addListener( 'l8', 'scope', 'other_event', pass );

    bus.addListener( 'l9', 'other_scope', 'event', pass );
    bus.addListener( 'l10', 'other_scope', 'other_event', pass );

    bus.addListener( 'l11', 'untriggered', 'untriggered', function() {
        assert( false );
    });

    bus.triggerListeners( 'scope', 'event', testArgs );
    bus.triggerListeners( 'scope', 'other_event', testArgs );
    bus.triggerListeners( 'other_scope', 'event', testArgs );
    bus.triggerListeners( 'other_scope', 'other_event', testArgs );
  })

  it('testRemoveEventListener', function(){
    const pass = () => assert( true );
    const fail = () => assert( false );
    let removed;

    bus.addListener( 'bad', 'scope', 'event', fail );
    bus.addListener( 'good', 'scope', 'event', pass );

    removed = bus.removeListener( 'bad', 'scope', 'event' );
    assert( removed );

    removed = bus.removeListener( 'good', 'other_scope', 'event' );
    assert( !removed );

    removed = bus.removeListener( 'good', 'scope', 'other_event', fail );
    assert( !removed );

    bus.triggerListeners( 'scope', 'event' );
  })

  it('testTrigger', function(){
    const okay =  () => assert( true );

    bus.setHandler( 'scope', 'event', okay );
    bus.addListener( 'l1', 'scope', 'event', okay );

    bus.trigger( 'scope', 'event' );
  })
})
