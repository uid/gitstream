var crypto = require('crypto'),
    q = require('q');

module.exports = function( opts ) {
    var dbcon = opts.dbcon,
        logger = opts.logger;

    return {
        getUserKey: function( userId ) {
            return dbcon.then( function( db ) {
                var users = db.collection('users');
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
                .then( function( user ) {
                    var userKey;

                    if ( user ) {
                        return user.key;
                    } else {
                        // LOGGING
                        logger.createLog( userId );

                        userKey = crypto.createHash('sha1')
                            .update( crypto.pseudoRandomBytes(40) )
                            .digest('hex');
                        q.nfcall( users.insert.bind( users ) , { id: userId, key: userKey } );
                        return userKey;
                    }
                });
            });
        },

        verifyMac: function( userId, mac, macMsg ) {
            return dbcon.then( function( db ) {
                var users = db.collection('users');
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } );
            })
            .then( function( user ) {
                var hmac;

                if ( !user ) {
                    throw Error('No user with id ' + userId);
                }

                hmac = crypto.createHmac( 'sha1', user.key )
                    .update( macMsg )
                    .digest('hex');

                if ( mac.length < 6 || hmac.indexOf( mac ) !== 0 ) {
                    throw Error('HMACs do not match');
                }
            });
        },

        createMac: function( key, macMsg, length ) {
            length = length || 6; // default for repos
            return crypto.createHmac( 'sha1', key )
                .update( macMsg )
                .digest('hex')
                .substring( 0, length );
        },

        createStudyId: function() {
            return crypto.createHash('sha1')
                .update( crypto.pseudoRandomBytes(20) )
                .digest('hex')
                .substring(0, 5);
        }
    };
};
