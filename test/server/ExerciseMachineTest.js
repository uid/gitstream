var ExerciseMachine = require('../../src/server/ExerciseMachine'),
    EventBus = require('git-angler').EventBus;

module.exports = {
    setUp: function( done ) {
        this.eventBus = new EventBus();
        this.repo = '/nhynes/test.git';
        done();
    },

    // initialization using init()
    testInitialize: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            test: {},
            otherState: {}
        }, this.repo, this.eventBus );
        em.init('test');
        test.strictEqual( em._state, 'test' );

        test.done();
    },

    // initialization using the startState parameter in the config
    testInitializeStartState: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {},
            otherState: {}
        }, this.repo, this.eventBus );
        em.init('otherState');
        test.strictEqual( em._state, 'test' );

        test.done();
    },

    // verify that halting emits 'halt' event and that further steps do nothing
    testHalt: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            testHalt: null,
            otherState: {}
        }, this.repo, this.eventBus );
        em.on( 'halt', function() {
            em._step('otherState');
            test.strictEqual( em._state, 'testHalt' );
            test.done();
        });
        em.init('testHalt');

    },

    // verify that stepping into a state emits the state as an event
    testStepBasic: function( test ) {
        test.expect( 2 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {},
            nextState: null
        }, this.repo, this.eventBus );

        em.on( 'step', function( newState, oldState ) {
            test.strictEqual( newState, 'nextState' );
            test.strictEqual( oldState, 'test' );
            test.done();
        });

        em._step('nextState');
    },

    // stepping into a state with a string value should go to the state specified by the value
    // shorthand for defining an onEnter value
    testStepStringForwarding: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: 'nextState',
            nextState: null
        }, this.repo, this.eventBus );

        test.strictEqual( em._state, 'nextState' );

        test.done();
    },

    // stepping into a state with a funtion value should go to the state specified by the return
    // value of the function. Shorthand for defining an onEnter function
    testStepFunctionForwarding: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: function() { return 'nextState'; },
            nextState: null
        }, this.repo, this.eventBus );

        test.strictEqual( em._state, 'nextState' );

        test.done();
    },

    // stepping into a state with a funtion value should halt if the return value is null
    testStepFunctionHalting: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: function() { return null; },
            nextState: null
        }, this.repo, this.eventBus );

        test.strictEqual( em._state, null );

        test.done();
    },

    // stepping into a state that defines a string for onEntry should forward to that state
    testStepEntryStringHalting: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {
                onEnter: 'nextState'
            },
            nextState: null
        }, this.repo, this.eventBus );

        test.strictEqual( em._state, 'nextState' );

        test.done();
    },

    // stepping into a state that defines a string-returning function  for onEntry should forward
    // to that state specified by the return value
    testStepEntryFunctionHalting: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {
                onEnter: function() {
                    return 'nextState';
                }
            },
            nextState: null
        }, this.repo, this.eventBus );

        test.strictEqual( em._state, 'nextState' );

        test.done();
    },

    // stepping into a state that defines a non-string-returning function for onEntry should
    // not forward to any other state
    testStepEntryFunctionJustExecute: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {
                onEnter: function() {
                    return false;
                }
            },
            nextState: null
        }, this.repo, this.eventBus );

        test.strictEqual( em._state, 'test' );

        test.done();
    },

    // tests that events are correctly registered as listeners and transition to next states
    // arguments passed to the stepping function should be those generated by the eventbus
    // `this` in a transition fn should be the state config object
    testEventedStep: function( test ) {
        test.expect( 5 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {
                onCommit: function( repo, action, info ) {
                    test.strictEqual( repo, '/nhynes/test.git' );
                    test.strictEqual( action, 'commit' );
                    test.ok( info.test );
                    test.ok( this.testHelper );
                    return 'nextState';
                },
                testHelper: true
            },
            nextState: null
        }, this.repo, this.eventBus );

        this.eventBus.trigger( this.repo, 'commit', [ { test: true } ] );

        test.strictEqual( em._state, 'nextState' );

        test.done();
    },

    // verifies that ExerciseMachine does not simply call properties that match on[A-Z][a-z]+
    testEventedStepIgnoreExtraneousOn: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
            startState: 'test',
            test: {
                onSomeNonGitEvent: 'nextState'
            },
            nextState: null
        }, this.repo, this.eventBus );

        this.eventBus.triggerListeners( '/nhynes/test.git', 'some-non-git-event' );

        test.strictEqual( em._state, 'test' );

        test.done();
    },

    // tests that listeners from the old state are removed
    testTeardown: function( test ) {
        test.expect( 1 );

        var em = new ExerciseMachine({
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
        }, this.repo, this.eventBus );

        this.eventBus.triggerListeners( this.repo, 'commit' );
        this.eventBus.triggerListeners( this.repo, 'push' );
        this.eventBus.triggerListeners( this.repo, 'commit' );
        test.strictEqual( em._state, 'goodState' );

        test.done();
    }
};
