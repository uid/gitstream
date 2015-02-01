// This module provides utilities that are exposed as `this` to the functions in the exercise confs

/* The ShadowBranch tracks (shadows) the tree of the local repository just
before andafter a commit. It is not valid after any other operation. */

var diff = require('diff'),
    fs = require('fs'),
    path = require('path'),
    q = require('q'),
    glob = require('glob'),
    utils = require('./utils'),

    SHADOWBRANCH = 'refs/gitstream/shadowbranch'

// TODO: write tests
module.exports = function( config ) {
    // a new one of these is made for each new ExerciseMachine
    var repoDir = config.repoDir,
        exerciseDir = config.exerciseDir,
        exercisePath = path.resolve( exerciseDir ), // the path to the exercise source dir
        repoPath = path.resolve( repoDir ), // the path to the real repo
        git = utils.git.bind( null, repoPath ),
        shadowFn = function( fn, args ) {
            var callback,
                result
            if ( typeof args[ args.length - 1 ] === 'function' ) {
                callback = args.pop()
            }

            return git( 'checkout', SHADOWBRANCH )
            .then( fn.apply.bind( fn, null, args ) )
            .then( function( output ) {
                result = output
                return git( 'checkout', 'master' )
            })
            .then( function() {
                return result
            })
            .nodeify( callback )
        },
        exUtils

    exUtils = {
        /**
         * Executes a git command
         * @param {String} cmd the git command to run
         * @param {String|Array} args the arguments to pass to the command
         * @param {Function} callback Optional. (err, data)
         * @return {Promise} if no callback is given
         */
        git: function() {
            var args = Array.prototype.slice.call( arguments ),
                callback = args.length >= 3 ? args.pop() : undefined
            return git.apply( null, arguments ).nodeify( callback )
        },

        /**
         * Returns a path to a given file relative to the exercise resources directory
         * @param {String} filePath the relative path to the file
         * @return {String} the path to the requested file
         */
        resourceFilePath: function( filePath ) {
            return path.join( exercisePath, filePath )
        },

        /**
         * Compares a file in an exercise repo with a the reference file in the exercise directory
         * @param {String} verifyFilePath the path of the file to validate
         *  - relative to the exercise repo
         * @param {String} referenceFilePath the path of the file against which to validate
         *  - relative to the exercsie directory
         * @param {Function} callback Optional. err, diff or null if files identical
         * @return {Promise} if no callback is given
         */
        compareFiles: function( verifyFilePath, referenceFilePath, callback ) {
            var rfc = q.nfcall.bind( fs.readFile ),
                pathToVerified = path.join( repoDir, verifyFilePath ),
                pathToReference = path.join( exerciseDir, referenceFilePath )

            return q.all([ rfc( pathToVerified ), rfc( pathToReference ) ])
            .spread( function( verifyFile, referenceFile ) {
                var fileDiff = diff.diffLines( verifyFile, referenceFile ),
                    diffp = fileDiff.length !== 1 || fileDiff[0].added || fileDiff[0].removed
                return diffp ? fileDiff : null
            })
            .nodeify( callback )
        },

        /**
         * Compares a file in an exercise repo's shadowbranch
         * with a the reference file in the exercise directory
         * @see compareFiles and the description of the shadowbranch
         */
        compareFilesShadow: function() {
            return shadowFn( exUtils.compareFiles, Array.prototype.slice.call( arguments ) )
        },

        /**
         * Diffs two refs.
         * @param {String} from the ref to be compared against
         * @param {String} to the compared ref
         * @param {Function} callback Optional. (err, diff)
         * @return {Promise} if no callback is given
         * If `to` is undefined, `from` will be compared to its parent(s).
         * If both `from` and `to` are undefined, `from` will default to HEAD
         */
        diff: function( from, to ) {
            var diffArgs = [ '-p' ],
                callback = arguments[ arguments.length - 1 ],
                cbfnp = typeof callback === 'function' ? 1 : 0

            diffArgs.push( arguments.length < 1 + cbfnp ? 'HEAD' : from )
            if ( arguments.length >= 2 + cbfnp ) {
                diffArgs.push(to)
            }

            return git( 'diff-tree', diffArgs ).nodeify( cbfnp ? callback : null )
        },

        /**
         * diff ref shadowbranch
         * @param {String} ref the real ref. Default: HEAD
         * @param {Function} callback Optional. (err, diff)
         * @return {Promise} if no callback is given
         */
        diffShadow: function() {
            var callback = arguments[ arguments.length - 1 ],
                cbfnp = typeof callback === 'function' ? 1 : 0,
                ref = arguments.length < 1 + cbfnp ? 'HEAD' : arguments[0]

            return git( 'diff-tree', [ '-p', ref, SHADOWBRANCH ] )
            .nodeify( cbfnp ? callback : null )
        },

        /**
         * Determines whether a file contains a specified string
         * @param {String} filename the path to the searched file
         * @param {String|RegExp} needle the String or RegExp for which to search
         * @param {Function} callback Optional. (err, Boolean containsString)
         * @return {Promise} if no callback is given
         */
        fileContains: function( filename, needle, callback ) {
            var needleRegExp = needle instanceof RegExp ? needle : new RegExp( needle )
            return q.nfcall( fs.readFile, path.join( repoPath, filename ) )
            .then( function( data ) {
                return needleRegExp.test( data.toString() )
            })
            .nodeify( callback )
        },

        /**
         * Determines whether a shadowed file contains a specified string
         * @see fileContains and the description of shadow branch, above
         */
        shadowFileContains: function() {
            return shadowFn( exUtils.fileContains, Array.prototype.slice.call( arguments ) )
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
         * @param {Function} callback Optional. err
         * @return {Promise} if no callback is given
         */
        addCommit: function( spec, callback ) {
            return utils.addCommit( repoPath, exercisePath, spec ).nodeify( callback )
        },

        /**
         * Returns the log message for a specified commit
         * @param {String} ref the ref to check. Default: HEAD
         * @param {Function} callback Optional. (err, String logMsg)
         * @return {Promise} if no callback is given
         */
        getCommitMsg: function() {
            var callback = arguments[ arguments.length - 1 ],
                cbfnp = typeof callback === 'function' ? 1 : 0,
                ref = arguments[ arguments.length - 1 - cbfnp ] || 'HEAD'

            return git( 'log', [ '-n1', '--pretty="%s"', ref ] )
            .then( function( msg ) {
                return /"(.*)"\s*/.exec( msg )[1]
            })
            .nodeify( cbfnp ? callback : null )
        },

        /**
         * Parses the commit message by filtering comments and stripping whitespace
         * @param {String} commitMsg the commit message
         * @return {Array} the lines of the commit msg excluding those starting with a #
         */
        parseCommitMsg: function( commitMsg ) {
            return commitMsg.split( /\r?\n/ ).filter( function( line ) {
                return line.charAt(0) !== '#' && line.length > 0
            }).map( function( line ) {
                return line.trim()
            })
        },

        /**
         * Determines whether a commit log message contains a specified string
         * @param {String|RegExp} needle the String or RegExp for which to search in the log message
         * @param {String} ref the ref to check. Default: HEAD
         * @param {Function} callback Optional. (err, Boolean containsString)
         * @return {Promise} if no callback is given
         */
        commitMsgContains: function( needle ) {
            var callback = arguments[ arguments.length - 1 ],
                cbfnp = typeof callback === 'function' ? 1 : 0,
                ref = arguments.length >= 2 + cbfnp ? arguments[1] : 'HEAD',
                needleRegExp = needle instanceof RegExp ? needle : new RegExp( needle )

            return exUtils.getCommitMsg( ref )
            .then( function( msg ) {
                return needleRegExp.test( msg )
            })
            .nodeify( cbfnp ? callback : null )
        },

        /**
         * Performs a glob match in the repo directory
         * @param {String} fileGlob the glob to match against
         * @param {Function} callback Optional. (err, [String]: matching filenames)
         * @return {Promise} if no callback is given
         */
        filesMatching: function( fileGlob, callback ) {
            return q.nfcall( glob, fileGlob, { cwd: repoDir, root: repoDir, silent: true } )
            .nodeify( callback )
        },

        shadowFilesMatching: function() {
            return shadowFn( exUtils.filesMatching, Array.prototype.slice.call( arguments ) )
        },

        /**
         * Checks for the existence of a file in the repo
         * @param {String} fileGlob a glob describing the the file
         * @param {Function} callback Optional. (err, Boolean fileExists)
         * @return {Promise} if no callback is given
         */
        fileExists: function( fileGlob, callback ) {
            return exUtils.filesMatching( fileGlob )
            .then( function( files ) { return files.length !== 0 })
            .nodeify( callback )
        },

        /**
         * Checks for the existence of a file in the repo's shadowbranch
         * @see fileExists and the description of the shadowbranch
         */
        shadowFileExists: function() {
            return shadowFn( exUtils.fileExists, Array.prototype.slice.call( arguments ) )
        }
    }

    return exUtils
}
