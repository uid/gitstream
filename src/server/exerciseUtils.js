var diff = require('diff'),
    fs = require('fs'),
    path = require('path'),
    spawn = require('child_process').spawn,
    q = require('q');

// TODO: write tests
module.exports = function( config ) {
    var repoDir = config.repoDir,
        exerciseDir = config.exerciseDir;

    return {
        /**
         * Compares a file in an exercise repo with a the reference file in the exercise directory
         * @param {String} filename the name of the file to validate
         * @param {Function} callback receives a diff object or null if files are identical
         */
        compareFiles: function( filename, callback ) {
            var fileToVerify = q.defer(),
                verifyAgainst = q.defer(),
                resolver = function( pathBase, deferred ) {
                    fs.readFile( path.join( pathBase, filename ), function( err, data ) {
                        if ( err ) { return deferred.reject( err ); }
                        deferred.resolve( data.toString() );
                    });
                };

            resolver( repoDir, fileToVerify );
            resolver( exerciseDir, verifyAgainst );

            q.all([ fileToVerify.promise, verifyAgainst.promise ])
                .fail( function( error ) { callback( error ); })
                .spread( function( exerciseFile, referenceExerciseFile ) {
                    var fileDiff = diff.diffLines( exerciseFile, referenceExerciseFile ),
                        diffp = fileDiff.length !== 1 || fileDiff[0].added || fileDiff[0].removed;
                    callback( null, ( diffp ? fileDiff : null ) );
                });
        },

        /**
         * Determines whether a file contains a specified string
         * @param {String} filename the path to the searched file
         * @param {String|RegExp} needle the String or RegExp for which to search
         * @param {Function} callback (err, Boolean containsString)
         */
        fileContains: function( filename, needle, callback ) {
            var needleRegExp = needle instanceof RegExp ? needle : new RegExp( needle );
            fs.readFile( filename, function( err, data ) {
                if ( err ) { return callback( err ); }
                callback( null, needleRegExp.test( data.toString() ) );
            });
        },

        /**
         * Returns the log message for a specified commit
         * @param {String} ref the ref to check. Default: HEAD
         * @param {Function} callback (err, String logMsg)
         */
        getCommitMsg: function( ref, callback ) {
            var cb = callback || ref,
                realRef = callback && ref ? ref : 'HEAD',
                log = spawn( 'git', [ 'log', '-n1', '--pretty="%s"', realRef ], {
                    cwd: path.resolve( repoDir )
                });

            log.stdout.on( 'data', function( logMsg ) {
                cb( null, logMsg.toString() );
            });

            log.stderr.on( 'data', function( errMsg ) {
                cb( errMsg.toString() );
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
         * @param {Function} callback a function that receives Boolean true iff file is accessible
         */
        fileExists: function( filename, callback ) {
            fs.stat( path.join( repoDir, filename ), function( err ) {
                callback( !err );
            });
        }
    };
};
