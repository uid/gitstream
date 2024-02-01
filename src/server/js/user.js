var crypto = require('crypto'),
    q = require('q')

module.exports = function( opts ) {
    var dbcon = opts.dbcon

    return {
        getUserKey: function( userId ) {
            return dbcon.then( function( db ) {
                var users = db.collection('users')
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
                .then( function( user ) {
                    var newUserKey

                    if ( user ) {
                        return q.fulfill( user.key )
                    } else {
                        newUserKey = crypto.pseudoRandomBytes(20).toString('hex'),
                        user = {
                            id: userId,
                            key: newUserKey,
                            created: Date.now()
                        }

                        return q.nfcall( users.insertOne.bind( users ), user )
                        .then( function() {
                            return newUserKey
                        })
                    }
                })
            })
        },

        verifyMac: function( userId, mac, macMsg ) {
            return dbcon.then( function( db ) {
                var users = db.collection('users')
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
            })
            .then( function( user ) {
                var hmac

                if ( !user ) {
                    throw Error('No user with id ' + userId)
                }

                hmac = crypto.createHmac( 'sha1', user.key )
                    .update( macMsg )
                    .digest('hex')

                if ( mac.length < 6 || hmac.indexOf( mac ) !== 0 ) {
                    throw Error('HMACs do not match')
                }
            })
        },

        createMac: function( key, macMsg, length ) {
            length = length || 6 // default for repos
            return crypto.createHmac( 'sha1', key )
                .update( macMsg )
                .digest('hex')
                .substring( 0, length )
        },

        createRandomId: function() {
            return 'user' + crypto.pseudoRandomBytes(3).toString('hex').substring(0, 5)
        }
    }
}
