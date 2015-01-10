var utils = require('../../src/server/utils')
module.exports = {
    testEventsToPropsDefaultPrefix: function( test ) {
        test.expect( 4 )

        var eventProps = utils.events2Props( [ 'test', 'a-test', 'a-nother-test', 'aTesT' ] )
        test.strictEqual( eventProps.onTest, 'test' )
        test.strictEqual( eventProps.onATest, 'a-test' )
        test.strictEqual( eventProps.onANotherTest, 'a-nother-test' )
        test.strictEqual( eventProps.onATesT, 'aTesT' )

        test.done()
    },

    testEventsToPropsCustomPrefix: function( test ) {
        test.expect( 4 )

        var eventProps = utils .events2Props( [ 'handle', 'on' ], [ 'test', 'a-test' ] )
        test.strictEqual( eventProps.onTest, 'test' )
        test.strictEqual( eventProps.handleTest, 'test' )
        test.strictEqual( eventProps.onATest, 'a-test' )
        test.strictEqual( eventProps.handleATest, 'a-test' )

        test.done()
    }
}
