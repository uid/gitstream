var mysql = require('mysql'),
    crypto = require('crypto'),
    q = require('q'),
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
        getUserKey: function( userId ) {
            var done = q.defer();
            sql.query('SELECT * FROM users WHERE name=?', [ userId ], function( err, results ) {
                var userKey;
                if ( err ) {
                    return done.reject( new Error( err ) );
                }

                if ( results.length === 0 ) {
                    userKey = crypto.createHash('sha1')
                        .update( crypto.pseudoRandomBytes(40) )
                        .digest('hex');
                    sql.query( 'INSERT INTO users (name, gitkey) VALUES (?, ?)',
                        [ userId, userKey ] );
                    done.resolve( userKey );
                } else {
                    done.resolve( results[0].gitkey );
                }
            });
            return done.promise;
        },

        verifyMac: function( userId, mac, macMsg ) {
            var done = q.defer();
            sql.query('SELECT * FROM users WHERE name=?', [ userId ], function( err, results ) {
                var userInfo,
                    hmac;

                if ( err ) {
                    return done.reject( new Error( err ) );
                }

                if ( results.length === 0 ) {
                    return done.resolve();
                }

                userInfo = results[0];

                hmac = crypto.createHmac( 'sha1', userInfo.gitkey )
                    .update( macMsg )
                    .digest('hex');

                done.resolve( mac.length >= 6 && hmac.indexOf( mac ) === 0 );
            });
            return done.promise;
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
