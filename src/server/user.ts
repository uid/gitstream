import crypto from 'crypto';
import q from 'q';

console.error('using user.ts');
module.exports = function( opts: any ) {
    var dbcon = opts.dbcon

    return {
        getUserKey: function( userId: any ) {
            return dbcon.then( function( db:any ) {
                var users = db.collection('users')
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
                .then( function( user ) {
                    let newUserKey: string;

                    if ( user ) {
                        return (<any>q).fulfill( (<any>user).key )
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

        verifyMac: function( userId: string, mac: string, macMsg: string ) {
            return dbcon.then( function( db: any ) {
                var users = db.collection('users')
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
            })
            .then( function( user: any ) {
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

        createMac: function( key: string, macMsg: string, length: number ) {
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
