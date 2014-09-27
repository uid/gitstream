'use strict';

module.exports = function() {
    return {
        timeLimit: 30,

        startState: 'createFile',

        createFile: {
            handlePreCommit: function( repo, action, info, gitDone, stepDone ) {
                if ( info.logMsg.toLowerCase() === 'git is great' ) {
                    gitDone();
                    stepDone('committedFile');
                } else {
                    gitDone( 1, 'GitStream [COMMIT REJECTED] Incorrect log message.' +
                                ' Expected "git is great" but was: "' + info.logMsg + '"' );
                    stepDone( 'createFile', info.logMsg );
                }
            }
        },

        committedFile: {
            onReceive: function( repo, action, info, done ) {
                this.fileExists( 'hg_sux.txt', function( exists ) {
                    if ( exists ) {
                        done('pushed');
                    } else {
                        done('createFile');
                    }
                });
            }
        },

        pushed: null
    };
};
