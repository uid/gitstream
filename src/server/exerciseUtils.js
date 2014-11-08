// This module provides utilities that are exposed as `this` to the functions in the exercise confs

/* The ShadowBranch tracks (shadows) the tree of the local repository just
before andafter a commit. It is not valid after any other operation. */

var diff = require('diff'),
    fs = require('fs'),
    path = require('path'),
    q = require('q'),
    utils = require('./utils');

// TODO: write tests
module.exports = function( config ) {
    // a new one of these is made for each new ExerciseMachine
    var repoDir = config.repoDir,
        exerciseDir = config.exerciseDir,
        exercisePath = path.resolve( exerciseDir ),
        repoPath = path.resolve( repoDir ),
        git = utils.git.bind( null, repoPath );

    function shadowFn( fn, args ) {
        var callback = args.pop(),
            result;

        git( 'checkout', [ 'refs/gitstream/shadowbranch' ] )
        .then( q.nfapply.bind( null, fn, args ) )
        .then( function() {
            result = Array.prototype.slice.call( arguments );
            return git( 'checkout', [ 'master' ] );
        })
        .catch( callback )
        .done( function() {
            callback.apply( null, [ null ].concat( result ) );
        });
    }

    return {
        /**
         * Compares a file in an exercise repo with a the reference file in the exercise directory
         * @param {String} verifyFilePath the path of the file to validate
         *  - relative to the exercise repo
         * @param {String} referenceFilePath the path of the file against which to validate
         *  - relative to the exercsie directory
         * @param {Function} callback receives a diff object or null if files are identical
         */
        compareFiles: function( verifyFilePath, referenceFilePath, callback ) {
            var rfc = q.nfcall.bind( fs.readFile ),
                pathToVerified = path.join( repoDir, verifyFilePath ),
                pathToReference = path.join( exerciseDir, referenceFilePath );

            q.all([ rfc( pathToVerified ), rfc( pathToReference ) ])
            .catch( callback )
            .spread( function( verifyFile, referenceFile ) {
                var fileDiff = diff.diffLines( verifyFile, referenceFile ),
                    diffp = fileDiff.length !== 1 || fileDiff[0].added || fileDiff[0].removed;
                callback( null, ( diffp ? fileDiff : null ) );
            })
            .done();
        },

        /**
         * Compares a file in an exercise repo's shadowbranch
         * with a the reference file in the exercise directory
         * @see compareFiles and the description of the shadowbranch
         */
        compareFilesShadow: function() {
            shadowFn( this.compareFiles, Array.prototype.slice.call( arguments ) );
        },

        /**
         * Determines whether a file contains a specified string
         * @param {String} filename the path to the searched file
         * @param {String|RegExp} needle the String or RegExp for which to search
         * @param {Function} callback (err, Boolean containsString)
         */
        fileContains: function( filename, needle, callback ) {
            var needleRegExp = needle instanceof RegExp ? needle : new RegExp( needle );
            fs.readFile( path.join( repoPath, filename ), function( err, data ) {
                if ( err ) { return callback( err ); }
                callback( null, needleRegExp.test( data.toString() ) );
            });
        },

        /**
         * Determines whether a shadowed file contains a specified string
         * @see fileContains and the description of shadow branch, above
         */
        shadowFileContains: function() {
            shadowFn( this.fileContains, Array.prototype.slice.call( arguments ) );
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
        addCommit: function( spec, callback ) {
            utils.gitAddCommit( repoPath, exercisePath, spec )
            .catch( callback )
            .done( function() {
                callback();
            });
        },

        /**
         * Returns the log message for a specified commit
         * @param {String} ref the ref to check. Default: HEAD
         * @param {Function} callback (err, String logMsg)
         */
        getCommitMsg: function( ref, callback ) {
            var cb = callback || ref,
                realRef = callback && ref ? ref : 'HEAD';

            git( 'log', [ '-n1', '--pretty="%s"', realRef ] )
            .catch( cb )
            .done( function( data ) {
                cb( null, data );
            });
        },

        /**
         * Parses the commit message by filtering comments and stripping whitespace
         * @param {String} commitMsg the commit message
         * @return {Array} the lines of the commit msg excluding those starting with a #
         */
        parseCommitMsg: function( commitMsg ) {
            return commitMsg.split( /\r?\n/ ).filter( function( line ) {
                return line.charAt(0) !== '#' && line.length > 0;
            }).map( function( line ) {
                return line.trim();
            });
        },

        /**
         * Determines whether a commit log message contains a specified string
         * @param {String|RegExp} needle the String or RegExp for which to search in the log message
         * @param {String} ref the ref to check. Default: HEAD
         * @param {Function} callback (err, Boolean containsString)
         */
        commitMsgContains: function( needle, ref, callback ) {
            var cb = callback || ref,
                realRef = callback ? ref : undefined,
                needleRegExp = needle instanceof RegExp ? needle : new RegExp( needle );

            this.getCommitMsg( realRef, function( err, logMsg ) {
                if ( err ) { return cb( err ); }
                cb( null, needleRegExp.test( logMsg ) );
            });
        },

        /**
         * Checks for the existence of a file in the repo
         * @param {String} filename the path to the file
         * @param {Function} callback (err, Boolean)
         */
        fileExists: function( filename, callback ) {
            fs.stat( path.join( repoDir, filename ), function( err ) {
                if ( err && err.code !== 'ENOENT' ) {
                    callback( err );
                } else {
                    callback( null, !err );
                }
            });
        },

        /**
         * Checks for the existence of a file in the repo's shadowbranch
         * @see fileExists and the description of the shadowbranch
         */
        shadowFileExists: function() {
            shadowFn( this.fileExists, Array.prototype.slice.call( arguments ) );
        }
    };
};
