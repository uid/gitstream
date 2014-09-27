'use strict';

var $ = require('zeptojs');

module.exports = function() {
    return {
        onDing: function() {
            $('#statusMessages').append('<h1 style="color:red">You ran out of time :( Try again!</h1>');
        },
        onHalt: function( haltState ) {
            if ( haltState === 'done' ) {
                $('#statusMessages').append('<h1 style="color:green">Good job! You did it!</h1>');
            } else if ( haltState === 'broken' ) {
                $('#statusMessages')
                .append('<h1 style="color:red">You got the merge wrong. Run go.sh to try again!</h1>');
            }
        },

        start: {
            editFile: function() {
                $('#statusMessages').append('<h3>Edit the file `merge_me.txt`, add, commit, and push your changes</h1>');
            }
        },

        pushCommit: {
            pullRepo: function() {
                $('#statusMessages').append('<h3>You should have noticed that you weren\'t able to push your changes. There\'s a merge conflict! Pull the repo and resolve it.</h3>');
            }
        },

        pullRepo: {
            mergeFile: function() {
                $('#statusMessages').append('<h3>So far so good. Now, resolve the merge conflict in favor of the upstream changes (i.e. not yours) and add+commit+push your merge</h3>');
            }
        }
    };
};
