var diff = require('diff'),
    fs = require('fs'),
    path = require('path'),
    spawn = require('child_process').spawn,
    q = require('q'),
    utils = require('./utils');

// TODO: write tests
module.exports = function( config ) {
    var repoDir = config.repoDir,
        exerciseDir = config.exerciseDir,
        exercisePath = path.resolve( exerciseDir ),
        repoPath = path.resolve( repoDir );

    return {
        /**
         * Compares a file in an exercise repo with a the reference file in the exercise directory
         * @param {String} verifyFilename the name of the file to validate
         * @param {String} referenceFilename the name of the file against which to validate
         * @param {Function} callback receives a diff object or null if files are identical
         */
        compareFiles: function( verifyFilename, referenceFilename, callback ) {
            var fileToVerify = q.defer(),
                verifyAgainst = q.defer(),
                resolver = function( pathBase, filename, deferred ) {
                    fs.readFile( path.join( pathBase, filename ), function( err, data ) {
                        if ( err ) { return deferred.reject( err ); }
                        deferred.resolve( data.toString() );
                    });
                };

            resolver( repoDir, verifyFilename, fileToVerify );
            resolver( exerciseDir, referenceFilename, verifyAgainst );

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
            fs.readFile( path.join( repoPath, filename ), function( err, data ) {
                if ( err ) { return callback( err ); }
                callback( null, needleRegExp.test( data.toString() ) );
            });
        },

        /**
         * Simulates collaboration by moving a file/directory from the exercise dir into the
         * working repo and then adding and committing.
         * @param {String} filenameSrc the name of the file in the exercise dir to be moved
         * @param {String} filenameDest the name of the file in the repo dir to overwrite
         * @param {String} commitMsg the commit message to use
         * @param {Function} callback (err)
         */
        simulateCollaboration: function( filenameSrc, filenameDest, commitMsg, callback ) {
            var exerciseFilePath = path.join( exercisePath, filenameSrc ),
                repoFilePath = path.join( repoPath, filenameDest ),
                cp = spawn( 'cp', [ '-R', exerciseFilePath, repoFilePath ] );

            cp.on( 'close', function( code ) {
                if ( code !== 0 ) { return; }

                utils.git( repoPath, 'add', filenameDest, function( err ) {
                    if ( err ) { return console.error( 'ERROR: ', err ); }
                    utils.git( repoPath, 'commit', [ '-m', commitMsg ], callback );
                });
            });

            cp.stderr.on( 'data', function( err ) { console.error( 'ERROR:', err.toString() ); });
        },

        /**
         * Returns the log message for a specified commit
         * @param {String} ref the ref to check. Default: HEAD
         * @param {Function} callback (err, String logMsg)
         */
        getCommitMsg: function( ref, callback ) {
            var cb = callback || ref,
                realRef = callback && ref ? ref : 'HEAD';

            utils.git( repoPath, 'log', [ '-n1', '--pretty="%s"', realRef ], function( err, data ) {
                cb( err, data );
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
