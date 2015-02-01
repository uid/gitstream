var spawn = require('child_process').spawn,
    path = require('path'),
    fs = require('fs'),
    q = require('q'),
    mustache = require('mustache'),
    utils

utils = module.exports = {
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
     * Recursively makes directories, a la `mkdir -p`
     * @param {String} dirPath the path to the directory to make
     * @param {String} base the directory in which to create the tree. Default: /
     * @return {Promise}
     */
    mkdirp: function( dirPath, base ) {
        var rel = base || '/',
            dirs = Array.isArray( dirPath ) ? dirPath : dirPath.split( path.sep ),
            theDir = path.join( rel, dirs.shift() || '' ),
            mkChildDir = dirs.length === 0 ? function() {} : utils.mkdirp.bind( null, dirs, theDir )

        return q.nfcall( fs.stat, theDir )
        .then( mkChildDir, function( e ) {
            if ( e.code === 'ENOENT' ) {
                return q.nfcall( fs.mkdir, theDir ).then( mkChildDir )
            }
            throw e
        })
    },

    /**
     * Templates a file and writes it out
     * @param {String} src the path to the source file/dir. Leave blank to create new file.
     * @param {String} dest the path to the output file/dir (only file if `src` is unspecified)
     * @param {Object} template a template object a la mustache
     * @return {Promise}
     */
    writeOut: function( src, dest, template ) {
        if ( !src ) {
            return utils.mkdirp( path.dirname( dest ) )
            .then( q.nfcall.bind( null, fs.writeFile, dest ) )
        }

        return q.nfcall( fs.stat, src )
        .then( function( stats ) {
            var srcPath = path.join.bind( null, src ),
                destPath = path.join.bind( null, dest )

            if ( stats.isDirectory() ) { // recursiely template and write out directory
                return q.nfcall( fs.mkdir, dest ) // make the dest directory
                .then( function() {
                    return q.nfcall( fs.readdir, src ) // recurse into the src dir
                })
                .then( function( dirContents ) {
                    return q.all( dirContents.map( function( file ) {
                        return utils.writeOut( srcPath( file ), destPath( file ), template )
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
     *    msg: String,
     *    author: String, // Default: GitStream <gitstream@csail.mit.edu>
     *    date: Date, // Default: current Date
     *    files: Array[String|Object]
     *      // if String, copies from src to dest. Assumes same directory structure
     *      // if Object, refers to a fileSpec, as described below
     *  }
     *
     *  fileSpec: {
     *    src: String, // path to file relative to `srcBase`. Leave blank when creating new files.
     *      // can be a directory. will be recursively templated/written out
     *    dest: String, // path to destination relative to `repo`. Will recursively create dirs.
     *    template: Object|Function, // a Mustache template object or object-generating function
     *      // the object-generating function receives the source path. noop if src is undefined
     *  }
     * @return {Promise} a promise on the completion of the commands
     */
    addCommit: function( repo, srcBase, spec ) {
        var srcPath = path.join.bind( null, arguments.length < 3 ? '/' : srcBase ),
            destPath = path.join.bind( null, repo ),
            commitAuthor = spec.author || 'GitStream <gitstream@csail.mit.edu>',
            commitDate = ( spec.date || new Date() ).toISOString(),
            commitMsg = spec.msg.replace( /'/g, '\\"' ),
            filesToStage = []

        return q.all( spec.files.map( function( fileSpec ) {
            var src = srcPath( typeof fileSpec === 'string' ? fileSpec : fileSpec.src ),
                dest = typeof fileSpec === 'string' ? fileSpec : fileSpec.dest || fileSpec.src,
                template = typeof fileSpec === 'string' ? {} : fileSpec.template

            filesToStage.push( ':' + dest )

            return utils.writeOut( src, destPath( dest ), template )
        }) )
        .then( function() {
            return utils.git( repo, 'add', filesToStage.join(' ') )
        })
        .then( function() {
            return utils.git( repo, 'commit', [
                '-m', '"' + commitMsg + '"',
                '--author="' + commitAuthor + '"',
                '--date=' + commitDate
            ])
        })
    }
}
