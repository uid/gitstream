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
            }
        },

        start: {
            editFile: function() {
                $('#statusMessages').append('<h3>Edit the file `a_nice_poem.txt` to contain a nice poem about git (it\'s okay, I won\'t judge). Add and then commit it with the message "wrote a nice poem"</h1>');
            }
        },

        editFile: {
            committedFile: function() {
                $('#statusMessages').append('<h3>Right on! Now push your changes.</h3>');
            }
        },

        committedFile: {
            editFile: function() {
                $('#statusMessages').append('<h3 style="color:red">Not quite. The file should contain a poem about git (i.e. should contain the string "git")</h3>');
            }
        }
    };
};
