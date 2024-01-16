import crypto from 'crypto';
import q from 'q';
import { Collection, Db } from 'mongodb';

interface User {
    id: string;
    key: string;
    created: number;
}

console.error('using user.ts');

module.exports = function(opts: {dbcon: Promise<Db>}) {
    const dbcon = opts.dbcon;

    return {
        getUserKey: function( userId: any ) {
            return dbcon.then( function( db:any ) {
                const users: Collection<User> = db.collection('users')
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
                .then( function( user: User | null) {
                    let newUserKey: string;

                    if ( user ) {
                        return (<any>q).fulfill(user.key ) // todo: fix, not sure how to remove 'any'
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
                } as (value: unknown) => void) // todo: fix.
                // Type assertion. Can't normally add type annotation here b/c q.nfcall expects param of type 'unknown' 
            })
        },

        verifyMac: function( userId: string, mac: string, macMsg: string ) {
            return dbcon.then( function( db: Db ) {
                const users: Collection<User> = db.collection('users')
                return q.nfcall( users.findOne.bind( users ), { id: userId }, { key: true } )
            })
            .then( function( user: User | null ) {
                let hmac;

                if ( !user ) {
                    throw Error('No user with id ' + userId)
                }

                hmac = crypto.createHmac( 'sha1', user.key )
                    .update( macMsg )
                    .digest('hex')

                if ( mac.length < 6 || hmac.indexOf( mac ) !== 0 ) {
                    throw Error('HMACs do not match')
                }
            } as (value: unknown) => void) //  todo: fix
            // Type assertion. Can't normally add type annotation here b/c q.nfcall expects param of type 'unknown'
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
