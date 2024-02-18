import { utils } from '../../server/utils.js'
import assert from 'assert'

describe('Utils', () => {
  it('testEventsToPropsDefaultPrefix', function (){
    const eventProps = utils.events2Props( [ 'test', 'a-test', 'a-nother-test', 'aTesT' ] )
    assert.strictEqual( eventProps.onTest, 'test' )
    assert.strictEqual( eventProps.onATest, 'a-test' )
    assert.strictEqual( eventProps.onANotherTest, 'a-nother-test' )
    assert.strictEqual( eventProps.onATesT, 'aTesT' )

  })

  it('testEventsToPropsCustomPrefix', function (){
    const eventProps = utils .events2Props( [ 'handle', 'on' ], [ 'test', 'a-test' ] )
    assert.strictEqual( eventProps.onTest, 'test' )
    assert.strictEqual( eventProps.handleTest, 'test' )
    assert.strictEqual( eventProps.onATest, 'a-test' )
    assert.strictEqual( eventProps.handleATest, 'a-test' )
  })
})