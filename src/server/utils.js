var spawn = require('child_process').spawn,
    fs = require('fs'),
    q = require('q');

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
     * @return {Promise} a promise resolved with the sha of the initial committ
     */
    getInitialCommit: function( repo ) {
        return this.git( repo, 'log', '--pretty="%H"' )
        .then( function( data ) {
            var commitIds = data.trim().replace( /"/g, '' ).split('\n');
            return commitIds.pop();
        });
    },

    /**
     * Executes a git command in a specified repo
     * @param {String} repo the path to the repository in which to execute the command
     * @param {String} cmd the git command to run
     * @param {String|Array} args the arguments to pass to the command
     * @return {Promise} a promise on the completion of the command
     */
    git: function( repo, cmd, args ) {
        return q.nfcall( fs.stat, repo )
        .then( function() {
            var cmdArgs = ( args instanceof Array ? args : args.trim().split(' ') ),
                git = spawn( 'git', [ cmd ].concat( cmdArgs ), { cwd: repo } ),
                output = '',
                errOutput = '';

            git.stderr.on( 'data', function( data ) { errOutput += data.toString(); });
            git.stdout.on( 'data', function( data ) { output += data.toString(); });

            git.on( 'close', function( code ) {
                errOutput = errOutput || ( code !== 0 ? code.toString() : '' );
                cb( errOutput, output );
            });
        });
    }
};
