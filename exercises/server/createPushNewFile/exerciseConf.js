module.exports = function() {
    return {
        startState: 'createFile',

        createFile: {
            onCommit: 'committedFile'
        },

        committedFile: {
            onPostReceive: 'pushed'
        },

        pushed: function( done ) {
            this.fileExists( 'hg_sux.txt', function( exists ) {
                this.commitMsgContains(/Git is great/i, function( err, logContains ) {
                    var statusMsg;
                    if ( exists ) {
                        done('done');
                    } else {
                        if ( !exists ) {
                            statusMsg = 'nofile';
                        } else if ( !logContains ) {
                            statusMsg = 'badmsg';
                        }
                        done( 'createFile', statusMsg );
                    }
                });
            }.bind( this ) );
        },

        done: null
    };
};
