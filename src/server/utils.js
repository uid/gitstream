var spawn = require('child_process').spawn;

module.exports = {
    /**
     * Converts events in dash-delimited format to properties of the form onEventName
     * @param {Array} prefix the prefix of the propified events. Default: on
     * @param {Array} events the events to propify
     * @return {Object} a hash from onEventName to event-name strings
     */
    events2Props: function( prefixesArg, eventsArg ) {
        var prefixes = eventsArg ? prefixesArg : [ 'on' ],
            events = eventsArg ? eventsArg : prefixesArg;
        return events.reduce( function( propHash, event ) {
            var eventPropSuffix = event.split('-').map( function( eventIdentifier ) {
                    return eventIdentifier.slice( 0, 1 ).toUpperCase() + eventIdentifier.slice( 1 );
                }).join('') ;
            prefixes.map( function( prefix ) {
                var eventProp = prefix + eventPropSuffix;
                propHash[ eventProp ] = event;
            });
            return propHash;
        }, {} );
    },

    /**
     * Returns the sha of the first commit made to the specified repository
     * @param {String} repoPath path to the repository in question
     * @param {Function} callback (err, commitSHA:String)
     */
    getInitialCommit: function( repo, callback ) {
        this.git( repo, 'log', '--pretty="%H"', function( errData, data ) {
            var commitIds = data.trim().replace( /"/g, '' ).split('\n');
            callback( errData, commitIds[ commitIds.length - 1 ] );
        });
    },

    /**
     * Executes a git command in a specified repo
     * @param {String} repoPath the path to the repository in which to execute the command
     * @param {String} cmd the git command to run
     * @param {String|Array} args the arguments to pass to the command
     * @param {Function} callback an errback (err, data) called upon completion
     */
    git: function( repo, cmd, args, callback ) {
        var cmdArgs = ( args instanceof Array ? args : args.trim().split(' ') ),
            git = spawn( 'git', [ cmd ].concat( cmdArgs ), { cwd: repo } ),
            output = '',
            errOutput = '';

        git.stderr.on( 'data', function( data ) { errOutput += data.toString(); });
        git.stdout.on( 'data', function( data ) { output += data.toString(); });

        git.on( 'close', function( code ) {
            errOutput = errOutput || ( code !== 0 ? code.toString : '' );
            callback( errOutput, output );
        });
    }
};
