import crypto from 'crypto';
import { Collection, Db } from 'mongodb';

interface User {
    id: string;
    key: string;
    created: number;
}

export function createUser(mongodb: Promise<Db>) {
    return {
        getUserKey: function(userId: string) {
            return mongodb.then(function( db: Db ) { 
                const users: Collection<User> = db.collection('users');

                return users.findOne({id: userId} , {projection: { key: true }})
                    .then(function(user: User | null) {
                        if (user) {
                            return Promise.resolve(user.key);
                        } else {
                            const newUserKey = crypto.pseudoRandomBytes(20).toString('hex'),

                            user = {
                                id: userId,
                                key: newUserKey,
                                created: Date.now()
                            };

                            return users.insertOne(user)
                                .then( function() {
                                    return newUserKey;
                                });
                        }
                    });
            })
        },

        verifyMac: function(userId: string, mac: string, macMsg: string) {
            return mongodb.then(function( db: Db) {
                const users: Collection<User> = db.collection('users');

                return users.findOne({id: userId}, {projection: {key: true}});
            })
            .then(function(user: User | null) {
                if (!user) {
                    throw Error('No user with id ' + userId)
                }

                const hmac = crypto.createHmac( 'sha1', user.key )
                    .update( macMsg )
                    .digest('hex')

                if (mac.length < 6 || hmac.indexOf(mac) !== 0 ) {
                    throw Error('HMACs do not match')
                }
            });
        },

        // length's default is 6 for repos
        createMac: function(key: string, macMsg: string, length: number = 6) {
            return crypto.createHmac('sha1', key)
                .update(macMsg)
                .digest('hex')
                .substring(0, length)
        },
    }
}
