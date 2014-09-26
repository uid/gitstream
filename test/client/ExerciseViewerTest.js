var ExerciseViewer = require('../../src/client/js/ExerciseViewer'),
    EventEmitter = require('events').EventEmitter;

module.exports = {
    setUp: function( done ) {
        this.events = new EventEmitter();
        done();
    },

    testInitFn: function( test ) {
        test.expect( 1 );

        var ev = ExerciseViewer({
            start: {
                testState: function() {
                    test.ok( true );
                },
                notTestState: function() {
                    test.ok( false );
                }
            }
        }, this.events );

        ev.init( 'testState' );
        ev.init( 'notTestState' );
        test.done();
    },

    testStepInit: function( test ) {
        test.expect( 1 );

        var ev = ExerciseViewer({
            testState: {
                onEnter: function() {
                    test.ok( true );
                    test.done();
                }
            }
        }, this.events );

        this.events.emit( 'step', 'testState', null );
    },

    testStepStep: function( test ) {
        test.expect( 3 );

        var ev = new ExerciseViewer({
            testState: {
                testState2: function() {
                    test.ok( true );
                    this.testState = 'wuz here';
                }
            },
            testState2: {
                onEnter: function() {
                    test.ok( true );
                    test.strictEqual( this.testState, 'wuz here' );
                    test.done();
                }
            }
        }, this.events );

        this.events.emit( 'step', 'testState', null );
        this.events.emit( 'step', 'testState2', 'testState' );
    },

    testStepHalt: function( test ) {
        test.expect( 1 );

        var ev = new ExerciseViewer({
            onHalt: function( haltState ) {
                test.strictEqual( haltState, 'haltsHere' );
                test.done();
            },
            haltsHere: {}
        }, this.events );

        this.events.emit( 'step', 'haltsHere', null );
        this.events.emit( 'halt', 'haltsHere' );
    },

    testStepDing: function( test ) {
        test.expect( 1 );

        var ev = new ExerciseViewer({
            onDing: function( dingState ) {
                test.strictEqual( dingState, 'levelUp' );
                test.done();
            },
            levelUp: {}
        }, this.events );

        this.events.emit( 'step', 'levelUp', null );
        this.events.emit( 'ding' );
    }
};
