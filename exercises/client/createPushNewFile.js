'use strict';

var $ = require('zeptojs');

module.exports = function() {
    return {
        onDing: function() {
            $('#statusMessages').append('<h1 style="color:red">You ran out of time :( Try again!</h1>');
        },
        onHalt: function( haltState ) {
            if ( haltState === 'pushed' ) {
                $('#statusMessages').append('<h1 style="color:green">Good job! You did it!</h3>');
            }
        },

        start: {
            createFile: function() {
                $('#statusMessages').append('<h3>Create a file named `hg_sux.txt`, add, and commit it with the message "git is great"</h1>');
            }
        },

        createFile: {
            committedFile: function() {
                $('#statusMessages').append('<h3>Right on! Now push your changes.</h3>');
            }
        },

        committedFile: {
            createFile: function() {
                $('#statusMessages').append('<h3 style="color:red">Not quite. The file name should have been &quot;hg_sux.txt&quot;</h3>');
            }
        }
    };
};
