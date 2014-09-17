module.exports = function() {
    return {
        startState: 'createFile',

        createFile: {
            onCommit: 'committedFile'
        },

        committedFile: {
            onReceive: 'pushed'
        },

        pushed: function( done ) {
            this.fileExists( 'hg_sux.txt', function( exists ) {
                this.commitMsgContains(/git is great/i, function( err, logContains ) {
                    var statusMsg;
                    if ( exists ) {
                        done('done');
                    } else if( !exists ){
                        done('createFile');
                    } else if ( !statusMsg ) {
                        done('committedFile');
                    }
                });
            }.bind( this ) );
        },

        done: null
    };
};
