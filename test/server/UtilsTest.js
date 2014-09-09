var utils = require('../../src/server/utils');
module.exports = {
    testEventsToProps: function( test ) {
        test.expect( 4 );

        var eventProps = utils.events2Props( 'test', 'a-test', 'a-nother-test', 'aTesT' );
        test.strictEqual( eventProps.onTest, 'test' );
        test.strictEqual( eventProps.onATest, 'a-test' );
        test.strictEqual( eventProps.onANotherTest, 'a-nother-test' );
        test.strictEqual( eventProps.onATesT, 'aTesT' );

        test.done();
    }
};
