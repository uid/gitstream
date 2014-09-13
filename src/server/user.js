var mysql = require('mysql'),
    crypto = require('crypto'),
    sql;

module.exports = function( opts ) {
    sql = mysql.createConnection({
        host: opts.sqlHost,
        user: opts.sqlUser,
        password: opts.sqlPass,
        database: opts.sqlDb
    });
    sql.connect();

    return {
        getUserKey: function( userId, cb ) {
            sql.query('SELECT * FROM users WHERE name=?', [ userId ], function( err, results ) {
                var userKey;
                if ( err ) {
                    cb( err );
                    return;
                }

                if ( results.length === 0 ) {
                    userKey = crypto.createHash('sha1')
                        .update( crypto.pseudoRandomBytes(40) )
                        .digest('hex');
                    sql.query( 'INSERT INTO users (name, gitkey) VALUES (?, ?)',
                        [ userId, userKey ] );
                    cb( null, userKey );
                } else {
                    cb( null, results[0].gitkey );
                }
            });
        },

        verifyMac: function( userId, mac, macMsg, cb ) {
            sql.query('SELECT * FROM users WHERE name=?', [ userId ], function( err, results ) {
                var userInfo,
                    hmac;

                if ( err ) {
                    return cb( err );
                }

                if ( results.length === 0 ) {
                    return cb( null );
                }

                userInfo = results[0];

                hmac = crypto.createHmac( 'sha1', userInfo.gitkey )
                    .update( macMsg )
                    .digest('hex');

                cb( null, mac.length >= 6 && hmac.indexOf( mac ) === 0 );
            });
        },

        createMac: function( userKey, macMsg, length ) {
            length = length || 6; // default for repos
            return crypto.createHmac( 'sha1', userKey )
                .update( macMsg )
                .digest('hex')
                .substring( 0, length );
        }
    };
};
