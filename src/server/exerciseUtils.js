var diff = require('diff'),
    fs = require('fs'),
    path = require('path'),
    spawn = require('child_process').spawn,
    q = require('q');

// TODO: write tests
module.exports = {
    /**
     * Compares a file in an exercise repo with a the reference file in the exercise directory
     * @param {String} pathToRepo the path to the [working] exercise repo
     * @param {String} exerciseDir the path to the directory containing the exercise files
     * @param {String} filename the name of the file to validate
     * @param {Function} callback receives a diff object or null if files are identical
     */
    compareFiles: function( pathToRepo, exerciseDir, filename, callback ) {
        var fileToVerify = q.defer(),
            verifyAgainst = q.defer(),
            resolver = function( pathBase, deferred ) {
                fs.readFile( path.join( pathBase, filename ), function( err, data ) {
                    if ( err ) { return deferred.reject( err ); }
                    deferred.resolve( data.toString() );
                });
            };

        resolver( pathToRepo, fileToVerify );
        resolver( exerciseDir, verifyAgainst );

        q.all([ fileToVerify.promise, verifyAgainst.promise ])
            .fail( function( error ) { callback( error ); })
            .spread( function( exerciseFile, referenceExerciseFile ) {
                var fileDiff = diff.diffLines( exerciseFile, referenceExerciseFile ),
                    hasDiffs = fileDiff.length === 1 && !fileDiff[0].added && !fileDiff[0].removed;
                callback( null, ( hasDiffs ? fileDiff : null ) );
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
     * @param {String} pathToRepo the path to the repo in question
     * @param {String} ref the ref to check. Default: HEAD
     * @param {Function} callback (err, String logMsg)
     */
    getCommitMsg: function( pathToRepo, ref, callback ) {
        var cb = callback || ref,
            realRef = callback ? ref : 'HEAD',
            log = spawn( 'git', [ 'log', '-n1', '--pretty="%s"', realRef ], {
                cwd: path.resolve( pathToRepo )
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
     * @param {String} pathToRepo the path to the repo in question
     * @param {String|RegExp} needle the String or RegExp for which to search in the log message
     * @param {String} ref the ref to check. Default: HEAD
     * @param {Function} callback (err, Boolean containsString)
     */
    commitMsgContains: function( pathToRepo, needle, ref, callback ) {
        var cb = callback || ref,
            realRef = callback ? ref : undefined,
            needleRegExp = needle instanceof RegExp ? needle : new RegExp( needle );

        this.getCommitMsg( pathToRepo, realRef, function( err, logMsg ) {
            if ( err ) { return cb( err ); }
            callback( null, needleRegExp.test( logMsg ) );
        });
    },


    /**
     * Checks for the existence of a file
     * @param {String} filename the path to the file
     * @param {Function} callback a function that receives Boolean true iff file is accessible
     */
    fileExists: function( filename, callback ) {
        fs.stat( filename, function( err ) {
            callback( !err );
        });
    }
};
