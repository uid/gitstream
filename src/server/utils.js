var spawn = require('child_process').spawn,
    path = require('path'),
    fs = require('fs'),
    q = require('q'),
    mustache = require('mustache')

module.exports = {
    /**
     * Converts events in dash-delimited format to properties of the form onEventName
     * @param {Array} prefix the prefix of the propified events. Default: on
     * @param {Array} events the events to propify
     * @return {Object} a hash from onEventName to event-name strings
     */
    events2Props: function( prefixesArg, eventsArg ) {
        var prefixes = eventsArg ? prefixesArg : [ 'on' ],
            events = eventsArg ? eventsArg : prefixesArg
        return events.reduce( function( propHash, event ) {
            var eventPropSuffix = event.split('-').map( function( eventIdentifier ) {
                    return eventIdentifier.slice( 0, 1 ).toUpperCase() + eventIdentifier.slice( 1 )
                }).join('')
            prefixes.map( function( prefix ) {
                var eventProp = prefix + eventPropSuffix
                propHash[ eventProp ] = event
            })
            return propHash
        }, {} )
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
            var done = q.defer(),
                cmdArgs = ( args instanceof Array ? args : args.trim().split(' ') ),
                git = spawn( 'git', [ cmd ].concat( cmdArgs ), { cwd: repo } ),
                output = '',
                errOutput = ''

            git.stderr.on( 'data', function( data ) { errOutput += data.toString() })
            git.stdout.on( 'data', function( data ) { output += data.toString() })

            git.on( 'close', function( code ) {
                if ( code !== 0 ) {
                    done.reject( Error( errOutput ) )
                } else {
                    done.resolve( output )
                }
            })

            return done.promise
        })
    },

    /**
     * Templates a file and writes it out
     * @param {String} src the path to the source file
     * @param {String} dest the path to the output file
     * @param {Object} template a template object a la mustache
     * @return {Promise}
     */
    writeTemplated: function( src, dest, template ) {
        var self = this,
            srcPath = path.join.bind( null, src ),
            destPath = path.join.bind( null, dest )
        return q.nfcall( fs.stat, src )
        .then( function( stats ) {
            if ( stats.isDirectory() ) { // recursiely template and write out directory
                return q.nfcall( fs.mkdir, dest ) // make the dest directory
                .then( function() {
                    return q.nfcall( fs.readdir, src ) // recurse into the src dir
                })
                .then( function( dirContents ) {
                    return q.all( dirContents.map( function( file ) {
                        return self.writeTemplated( srcPath( file ), destPath( file ), template )
                    }) )
                })
            } else {
                return q.nfcall( fs.readFile, src, { encoding: 'utf8' } )
                .then( function( file ) {
                    var fileTemplate = typeof template === 'function' ? template( src ) : template,
                        templated = mustache.render( file, fileTemplate )
                    return q.nfcall( fs.writeFile, dest, templated )
                })
            }
        })
    },

    /**
     * Adds the specified files (possibly templated) to the given repo and commits them
     * @param {String} repo the path to the repository. Dest files are relative to the repo root
     * @param {String} srcBase path to which src files paths are relative. Default: /
     * @param {Object} spec the specification for the commit
     *  spec: {
     *      msg: String,
     *      author: String,
     *      date: Date,
     *      files: [ 'filepath', { src: 'path', dest: 'path', template: (Object|Function) } ],
     *      // note: template and dest are optional in long-form file specs
     *   }
     * @return {Promise} a promise on the completion of the commands
     */
    gitAddCommit: function( repo, srcBase, spec ) {
        var self = this,
            srcPath = path.join.bind( null, srcBase || '/' ),
            destPath = path.join.bind( null, repo ),
            commitAuthor = spec.author || 'Nick Hynes <nhynes@mit.edu>',
            commitDate = ( spec.date || new Date() ).toISOString(),
            filesToStage = []

        return q.all( spec.files.map( function( fileSpec ) {
            var src = srcPath( typeof fileSpec === 'string' ? fileSpec : fileSpec.src ),
                dest = typeof fileSpec === 'string' ? fileSpec : fileSpec.dest || fileSpec.src,
                template = typeof fileSpec === 'string' ? {} : fileSpec.template

            filesToStage.push( dest )

            return self.writeTemplated( src, destPath( dest ), template )
        }) )
        .then( function() {
            return self.git( repo, 'add', filesToStage.join(' ') )
        })
        .then( function() {
            return self.git( repo, 'commit',
                [ '-m', spec.msg, '--author="' + commitAuthor + '"', '--date=' + commitDate ])
        })
    }
}
