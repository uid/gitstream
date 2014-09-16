var ExerciseViewer = require('../../src/client/js/ExerciseViewer'),
    EventEmitter = require('events').EventEmitter;

module.exports = {
    setUp: function( done ) {
        this.events = new EventEmitter();
        done();
    },

    testStepInit: function( test ) {
        test.expect( 2 );

        var ev = ExerciseViewer({
            testState: {
                onEnter: function() {
                    test.ok( true );
                    test.strictEqual( this.test, 'testing' );
                    test.done();
                }
            }
        }, this.events, { test: 'testing' } );

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
        test.expect( 2 );

        var ev = new ExerciseViewer({
            onHalt: function( haltState ) {
                test.strictEqual( this.hey, 'did you halt?' );
                test.strictEqual( haltState, 'haltsHere' );
                test.done();
            },
            haltsHere: {}
        }, this.events, { hey: 'did you halt?' } );

        this.events.emit( 'step', 'haltsHere', null );
        this.events.emit( 'halt' );
    },

    testStepDing: function( test ) {
        test.expect( 2 );

        var ev = new ExerciseViewer({
            onDing: function( dingState ) {
                test.strictEqual( this.hey, 'this is not an RPG' );
                test.strictEqual( dingState, 'levelUp' );
                test.done();
            },
            levelUp: {}
        }, this.events, { hey: 'this is not an RPG' } );

        this.events.emit( 'step', 'levelUp', null );
        this.events.emit( 'ding' );
    }
};
