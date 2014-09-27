'use strict';

module.exports = function() {
    return {
        timeLimit: 20,
        startState: 'editFile',

        editFile: {
            handlePreCommit: function( repo, action, info, gitDone, stepDone ) {
                if ( info.logMsg.toLowerCase() === 'wrote a nice poem' ) {
                    gitDone();
                    stepDone('committedFile');
                } else {
                    gitDone( 1, 'GitStream [COMMIT REJECTED] Incorrect log message.' +
                                'Expected "wrote a nice poem" but was: "' + info.logMsg + '"' );
                    stepDone( 'editFile', info.logMsg );
                }
            }
        },

        committedFile: {
            onReceive: function( repo, action, info, done ) {
                this.fileContains( 'a_nice_poem.txt', /.+/, function( err, containsString ) {
                    if ( containsString ) {
                        done('done');
                    } else {
                        done('editFile');
                    }
                });
            }
        },

        done: null
    };
};
