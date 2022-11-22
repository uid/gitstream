var EventBus = require('../lib/EventBus'),
    testArgs = [ 'arg1', 'arg2', 'arg3' ];

module.exports = {
    setUp: function( callback ) {
        this.bus = EventBus();
        callback();
    },

    testHandlerScopedSingleEvent: function( test ) {
        var triggered,
            expected = [ 'scope', 'event' ].concat( testArgs );

        test.expect( 3 );

        this.bus.setHandler( 'scope', 'event', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), expected );
        });

        this.bus.setHandler( 'other_scope', '*', function() {});
        this.bus.setHandler( 'other_scope', 'event', function() {});

        triggered = this.bus.triggerHandler( 'scope', 'event', testArgs );
        test.ok( triggered );

        this.bus.triggerHandler( 'other_scope', 'event', testArgs );

        triggered = this.bus.triggerHandler( 'no', 'handler', testArgs );
        test.ok( !triggered );

        test.done();
    },

    testHandlerScopedAllEvents: function( test ) {
        var invocations = 0;
        test.expect( 2 );

        this.bus.setHandler( 'scope', '*', function() {
            var expected = ( invocations === 0 ? [ 'scope', 'event1' ] : [ 'scope', 'event2' ] )
                            .concat( testArgs );
            invocations++;
            test.deepEqual( Array.prototype.slice.call( arguments ), expected );
        });

        this.bus.setHandler( 'other_scope', 'event1', function() {});
        this.bus.setHandler( 'other_scope', '*', function() {});

        this.bus.triggerHandler( 'scope', 'event1', testArgs );
        this.bus.triggerHandler( 'scope', 'event2', testArgs );
        this.bus.triggerHandler( 'other_scope', 'event', testArgs );
        test.done();
    },

    testHandlerGlobalSingleEvent: function( test ) {
        var invocations = 0;

        test.expect( 2 );

        this.bus.setHandler( '*', 'event', function() {
            var expected = ( invocations === 0 ? [ 'scope1', 'event' ] : [ 'scope2', 'event' ] )
                            .concat( testArgs );
            invocations++;
            test.deepEqual( Array.prototype.slice.call( arguments ), expected );
        });

        this.bus.setHandler( '*', 'other_event', function() {});
        this.bus.setHandler( 'scope1', '*', function() {});
        this.bus.setHandler( 'scope2', '*', function() {});
        this.bus.setHandler( 'scope1', 'event', function() {});
        this.bus.setHandler( 'scope2', 'event', function() {});
        this.bus.setHandler( 'scope1', 'other_event', function() {});
        this.bus.setHandler( 'scope2', 'other_event', function() {});

        this.bus.triggerHandler( 'scope1', 'event', testArgs );
        this.bus.triggerHandler( 'scope2', 'event', testArgs );
        this.bus.triggerHandler( 'scope1', 'other_event' );
        test.done();
    },

    testHandlerGlobalAllEvents: function( test ) {
        test.expect( 4 );

        this.bus.setHandler( '*', '*', function() {
            test.ok( true );
        });

        this.bus.setHandler( '*', 'event', function() {});
        this.bus.setHandler( '*', 'other_event', function() {});
        this.bus.setHandler( 'scope1', '*', function() {});
        this.bus.setHandler( 'scope2', '*', function() {});
        this.bus.setHandler( 'scope1', 'event', function() {});
        this.bus.setHandler( 'scope2', 'event', function() {});
        this.bus.setHandler( 'scope1', 'other_event', function() {});
        this.bus.setHandler( 'scope2', 'other_event', function() {});

        this.bus.triggerHandler( 'scope1', 'event', testArgs );
        this.bus.triggerHandler( 'scope2', 'event', testArgs );
        this.bus.triggerHandler( 'scope1', 'other_event', testArgs );
        this.bus.triggerHandler( 'scope2', 'other_event', testArgs );
        test.done();
    },

    testReplaceHandler: function( test ) {
        var f = function() { test.ok( true ); },
            oldHandler;
        test.expect( 1 );
        this.bus.setHandler( '*', '*', f );
        oldHandler = this.bus.setHandler( '*', '*', null );
        if ( oldHandler.call ) { oldHandler(); }
        test.done();
    },


    testListenerScopedSingleEvent: function( test ) {
        var triggered,
            expected = [ 'scope', 'event' ].concat( testArgs );

        test.expect( 4 );

        this.bus.addListener( 'l1', 'scope', 'event', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), expected );
        });
        this.bus.addListener( 'l2', 'scope', 'event', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), expected );
        });

        this.bus.addListener( 'l3', 'other_scope', 'event', function() {
            test.ok( false );
        });
        this.bus.addListener( 'l4', 'other_scope', '*', function() {
            test.ok( false );
        });

        triggered = this.bus.triggerListeners( 'scope', 'event', testArgs );
        test.ok( triggered );

        triggered = this.bus.triggerListeners( 'none', 'triggered', testArgs );
        test.ok( !triggered );

        test.done();
    },

    testListenerScopedAllEvents: function( test ) {
        var invocations = 0,
            getExpected = function() {
                return ( invocations === 0 ? [ 'scope', 'event' ] : [ 'scope', 'other_event' ] )
                    .concat( testArgs );
            };

        test.expect( 6 );

        this.bus.addListener( 'l1', 'scope', '*', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
        });
        this.bus.addListener( 'l2', 'scope', '*', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
        });
        this.bus.addListener( 'l3', 'scope', 'event', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
        });
        this.bus.addListener( 'l4', 'scope', 'event', function() {
            test.deepEqual( Array.prototype.slice.call( arguments ), getExpected() );
        });

        this.bus.addListener( 'l5', 'other_scope', '*', function() {
            test.ok( false );
        });
        this.bus.addListener( 'l6', 'other_scope', 'event', function() {
            test.ok( false );
        });

        this.bus.triggerListeners( 'scope', 'event', testArgs );
        invocations++;
        this.bus.triggerListeners( 'scope', 'other_event', testArgs );
        test.done();
    },

    testListenerGlobalSingleEvent: function( test ) {
        test.expect( 6 );

        this.bus.addListener( 'l1', '*', 'event', function() {
            test.ok( true );
        });
        this.bus.addListener( 'l2', '*', 'event', function() {
            test.ok( true );
        });
        this.bus.addListener( 'l3', 'scope', 'event', function() {
            test.ok( true );
        });
        this.bus.addListener( 'l4', 'scope', 'event', function() {
            test.ok( true );
        });

        this.bus.addListener( 'l5', 'other_scope', 'other_event', function() {
            test.ok( false );
        });
        this.bus.addListener( 'l6', 'other_scope', 'other_event', function() {
            test.ok( false );
        });

        this.bus.triggerListeners( 'scope', 'event', testArgs );
        this.bus.triggerListeners( 'other_scope', 'event', testArgs );
        test.done();
    },

    testListenerGlobalAllEvents: function( test ) {
        var pass = function() { test.ok( true ); };

        test.expect( 20 );

        this.bus.addListener( 'l1', '*', '*', pass );
        this.bus.addListener( 'l2', '*', '*', pass );

        this.bus.addListener( 'l3', '*', 'event', pass );
        this.bus.addListener( 'l4', '*', 'other_event', pass );

        this.bus.addListener( 'l5', 'scope', '*', pass );
        this.bus.addListener( 'l6', 'other_scope', '*', pass );

        this.bus.addListener( 'l7', 'scope', 'event', pass );
        this.bus.addListener( 'l8', 'scope', 'other_event', pass );

        this.bus.addListener( 'l9', 'other_scope', 'event', pass );
        this.bus.addListener( 'l10', 'other_scope', 'other_event', pass );

        this.bus.addListener( 'l11', 'untriggered', 'untriggered', function() {
            test.ok( false );
        });

        this.bus.triggerListeners( 'scope', 'event', testArgs );
        this.bus.triggerListeners( 'scope', 'other_event', testArgs );
        this.bus.triggerListeners( 'other_scope', 'event', testArgs );
        this.bus.triggerListeners( 'other_scope', 'other_event', testArgs );

        test.done();
    },

    testRemoveEventListener: function( test ) {
        var pass = function() { test.ok( true ); },
            fail = function() { test.ok( false ); },
            removed;

        test.expect( 4 );

        this.bus.addListener( 'bad', 'scope', 'event', fail );
        this.bus.addListener( 'good', 'scope', 'event', pass );

        removed = this.bus.removeListener( 'bad', 'scope', 'event' );
        test.ok( removed );

        removed = this.bus.removeListener( 'good', 'other_scope', 'event' );
        test.ok( !removed );

        removed = this.bus.removeListener( 'good', 'scope', 'other_event', fail );
        test.ok( !removed );

        this.bus.triggerListeners( 'scope', 'event' );

        test.done();
    },

    testTrigger: function( test ) {
        var okay = function() { test.ok( true ); };

        test.expect( 2 );

        this.bus.setHandler( 'scope', 'event', okay );
        this.bus.addListener( 'l1', 'scope', 'event', okay );

        this.bus.trigger( 'scope', 'event' );

        test.done();
    }
};
