'use strict';

var mergeme = 'merge_me.txt',
    mergeCollab = 'merge_me_collaborated.txt';

module.exports = function() {
    return {
        timeLimit: 80,
        startState: 'editFile',

        editFile: {
            handlePreCommit: function( repo, action, info, gitDone, stepDone ) {
                this.simulateCollaboration( mergeCollab, mergeme, 'Eat that!', function() {
                    gitDone();
                    stepDone('pushCommit');
                });
            }
        },
        // possibly disable all pulls between these states to prevent pulling down the conflict
        pushCommit: {
            onPreInfo: 'pullRepo'
        },

        pullRepo: {
            onPull: 'mergeFile'
        },

        mergeFile: {
            onReceive: function( repo, action, info, done ) {
                this.fileContains( 'merge_me.txt', /^merge conflicts aren't so bad :\)[\n\r ]*$/i, function( err, containsString ) {
                    if ( containsString ) {
                        done('done');
                    } else {
                        done('broken');
                    }
                });
            }
        },

        done: null,

        broken: null
    };
};
