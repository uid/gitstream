module.exports = function() {
    return {
        startState: 'createFile',

        createFile: {
            handlePreCommit: function( repo, action, info, gitDone, stepDone ) {
                if ( info.logMsg.toLowerCase() === 'git is great' ) {
                    gitDone();
                    stepDone('committedFile');
                } else {
                    gitDone( 1, 'GitStream [COMMIT REJECTED] Incorrect log message.' +
                                'Expected "git is great" but was: "' + info.logMsg + '"' );
                    stepDone( 'createFile', info.logMsg );
                }
            }
        },

        committedFile: {
            onReceive: function() {
                this.fileExists( 'hg_sux.txt', function( exists ) {
                    if ( exists ) {
                        done('pushed');
                    } else {
                        done('committedFile');
                    }
                });
            }
        },

        pushed: null
    };
};
