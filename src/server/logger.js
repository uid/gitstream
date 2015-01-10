var q = require('q')

module.exports = function( opts ) {
    var dbcon = opts.dbcon

    return {
        EVENT: {
            REPO_404: 'REPO_404',
            GIT: 'GIT',
            QUIT: 'QUIT',
            EM: 'EM',
            GO: 'GO',
            CHANGE_EXERCISE: 'CHANGE_EXERCISE',
            SYNC: 'SYNC'
        },

        log: function( userId, eventType, data ) {
            if ( !this.EVENT[ eventType ] ) {
                throw Error('Attempted to log invalid event: ' + eventType)
            }
            var record = {
                userId: userId,
                event: eventType,
                timestamp: Date.now(),
                data: data
            }
            dbcon.then( function( db ) {
                db.collection('logs').findOneAndUpdate({ userId: userId }, {
                    $push: { events: record }
                }, function( err ) {
                    if ( err ) { console.err('LOG ERROR:', err) }
                })
            })
            .done()
        },

        createLog: function( userId ) {
            var userLog = {
                userId: userId,
                created: Date.now(),
                events: []
            }
            dbcon.then( function( db ) {
                var logs = db.collection('logs')
                return q.nfcall( logs.insert.bind( logs ), userLog )
            })
            .done()
        }
    }
}
