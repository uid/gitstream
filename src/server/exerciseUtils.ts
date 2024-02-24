// This module provides utilities that are exposed as `this` to the functions in the exercise confs

import { diffLines } from 'diff'
import fs from 'fs'
import path from 'path'
import q from 'q'
import { CommitSpec, utils } from './utils.js'
import Q from 'q'
import { glob } from 'glob';

/* The ShadowBranch tracks (shadows) the tree of the local repository just
before and after a commit. It is not valid after any other operation. */
const SHADOWBRANCH = 'refs/gitstream/shadowbranch'

type Config = {
    repoDir: string;
    exerciseDir: string;
};
  
// TODO: write tests
export function exerciseUtils( config: Config ) {
    // a new one of these is made for each new ExerciseMachine
    const repoDir = config.repoDir,
        exerciseDir = config.exerciseDir,
        exercisePath = path.resolve( exerciseDir ), // the path to the exercise source dir
        repoPath = path.resolve( repoDir ), // the path to the real repo
        git = utils.git.bind( null, repoPath )

    // todo: this function is weird, take a closer look
    const shadowFn = function( fn: Function, args: any ): Q.Promise<any> { // todo: fix use of any
            let callback: (reason: any, value: any) => void = () => {}; // todo: fix, kinda jank
            let result: any; // todo: fix use of any
            
            if ( typeof args[ args.length - 1 ] === 'function' ) {
                callback = args.pop()
            }

            return git( 'checkout', SHADOWBRANCH )
                .then( fn.apply.bind( fn, null, args ) )
                .then( function( output: any ) { // todo: wait, this will be fixed once utils becomes an import
                    result = output
                    return git( 'checkout', 'main' )
                })
                .then( function() {
                    return result
                })
                .nodeify( callback )
        }

    const exUtils = {
        /**
         * Executes a git command
         * @param cmd - the git command to run 
         * @param args - the argument(s) to pass to the command
         * @param callback - Optional callback. (err, data)  
         * @returns a promise if no callback is given
         */
        git: function (
            cmd: string,
            args: string[] | string,
            callback?: (err: any, data: any) => void
        ): Q.Promise<any> | void {
            const argsArray = Array.isArray(args) ? args : args.trim().split(' ');
            
            if (callback) {
                return utils.git(repoPath, cmd, argsArray).nodeify(callback);
            }
        },
        
        /**
         * Returns a path to a given file relative to the exercise resources directory
         * @param filePath - the relative path to the file
         * @return the path to the requested file
         */
        resourceFilePath: function(filePath: string): string {
            return path.join(exercisePath, filePath)
        },

        /**
         * Compares a file in an exercise repo with a the reference file in the exercise directory
         * @param verifyFilePath - the path of the file to validate
         *  - relative to the exercise repo
         * @param referenceFilePath - the path of the file against which to validate
         *  - relative to the exercsie directory
         * @param callback Optional. err, diff or null if files identical
         * @return a promise, if no callback is given
         */
        compareFiles: function(
            verifyFilePath: string,
            referenceFilePath: string, 
            callback: (reason: any, value: any) => void = () => {} //todo: modify types of callback
        ): Q.Promise<any> { // todo: remove any            
            // todo: fix callback needing to be a default of blank
            const pathToVerified = path.join(repoDir, verifyFilePath),
                pathToReference = path.join(exerciseDir, referenceFilePath);

            return q.all([
                q.nfcall(fs.readFile, pathToVerified, 'utf8'),
                q.nfcall(fs.readFile, pathToReference, 'utf8')
            ])
            .spread(function(verifyFile, referenceFile) {
                const fileDiff = diffLines(verifyFile, referenceFile),
                    diffp = fileDiff.length !== 1 || fileDiff[0].added || fileDiff[0].removed;
                return diffp ? fileDiff : null;
            })
            .nodeify(callback);
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
         * @param from - the ref to be compared against
         * @param to - the compared ref
         * @param callback Optional. (err, diff)
         * @return a promise, if no callback is given
         * If `to` is undefined, `from` will be compared to its parent(s).
         * If both `from` and `to` are undefined, `from` will default to HEAD
         */
        diff: function( from?: string,
            to?: string,
            callback: (err: any, diff: any) => void = () => {}
        ): Q.Promise<any> {
            const diffArgs = [ '-p' ];

            const cbfnp: number = typeof callback === 'function' ? 1 : 0; // I think this stands for call back function present?

            diffArgs.push( arguments.length < 1 + cbfnp ? 'HEAD' : from as string); // // todo: fix
            if ( arguments.length >= 2 + cbfnp ) {
                diffArgs.push(to as string) // todo: fix
            }

            return git( 'diff-tree', diffArgs )
            .nodeify(callback)
            

            // todo: verify that this refactoring is correct before swapping 

            // const diffArgs = ['-p'];

            // if (from === undefined) {
            //     diffArgs.push('HEAD');
            // } else {
            //     diffArgs.push(from);
            //     if (to !== undefined) {
            //         diffArgs.push(to);
            //     }
            // }
        
            // return git('diff-tree', diffArgs).nodeify(callback || (() => {})); // todo: fix, kinda weird
        },

        /**
         * diff ref shadowbranch
         * @param ref - the real ref. Default: 'HEAD'
         * @param callback - Optional. (err, diff)
         * @return a promise if no callback is given
         */
        diffShadow: function() {
            const callback = arguments[ arguments.length - 1 ],
                cbfnp = typeof callback === 'function' ? 1 : 0,
                ref = arguments.length < 1 + cbfnp ? 'HEAD' : arguments[0]

            return git( 'diff-tree', [ '-p', ref, SHADOWBRANCH ] )
            .nodeify( cbfnp ? callback : null )
        },
        
        // todo: not sure why this refactoring doesn't work
        // diffShadow: function(ref: string = 'HEAD', callback?: (err: any, diff: any) => void): q.Promise<any> { // todo: any
        //     return git( 'diff-tree', [ '-p', ref, SHADOWBRANCH ] )
        //     .nodeify(  callback || (() => {}) ) // todo: fix, kinda weird
        // },

        /**
         * Determines whether a file contains a specified string
         * @param filename the path to the searched file
         * @param needle the String or RegExp for which to search
         * @param callback Optional. (err, Boolean containsString)
         * @return a promise if no callback is given
         */
        fileContains: function(
            filename: string, needle: string | RegExp,
            callback: (err: any, diff: any) => void = () => {}
        ): Q.Promise<boolean> {
            const needleRegExp = needle instanceof RegExp ? needle : new RegExp(needle)
            
            return q.nfcall( fs.readFile, path.join( repoPath, filename ) )
            .then( function( data: Buffer ) {
                return needleRegExp.test( data.toString() )
            } as (value: unknown) => boolean) // bc function wants data to be of type unknown
            .nodeify( callback)
        },

        // todo: remove? not used
        /**
         * Determines whether a shadowed file contains a specified string
         * @param args - A list of arguments to pass to the `fileContains` function.
         * @see fileContains and the description of shadow branch, above
         */
        shadowFileContains: function(...args: any[]) {
            return shadowFn( exUtils.fileContains, args)
        },

        // todo: remove? doesn't seem to be used
        /**
         * Adds the specified files (possibly templated) to the given repo and commits them
         * @param callback Optional. err
         * @return a promise if no callback is given
         */
        addCommit: function(
            spec: CommitSpec,
            callback: (err: any) => void = () => {}
        ): Q.Promise<any> { // todo: any. also, the default val for repo may be wrong
            // note: default values are defined at top of file

            const repo = repoPath; // the path to the repository. Dest files are relative to the repo root
            const srcBase = exercisePath; // path to which src files paths are relative. Default: `/`
            
            return utils.addCommit( repo, srcBase, spec )
            .nodeify( callback )
        },

        /**
         * Returns the log message for a specified commit
         * @param ref - the ref to check. Default: HEAD
         * @param callback - Optional. (err, String logMsg)
         * @return a promise if no callback is given
         */
        getCommitMsg: function(
            ref: string = 'HEAD',
            callback: (err: Error | null , msg: string | null) => void = () => {}
        ): Q.Promise<string> {

            return git( 'log', [ '-n1', '--pretty="%s"', ref ] )
            .then( function( msg: any ) { // todo: wait, this will be fixed once utils becomes an import
                const match = /"(.*)"\s*/.exec(msg);
                if (match) {
                    return match[1];
                } else {
                    // Handle the case where the regex does not match
                    throw new Error("Regex match failed");
                }
            })
            .nodeify(callback)
        },

        /**
         * Parses the commit message by filtering comments and stripping whitespace
         * @param commitMsg the commit message
         * @return the lines of the commit msg excluding those starting with a #
         */
        parseCommitMsg: function(commitMsg: string): string[] {
            return commitMsg.split( /\r?\n/ ).filter( function( line ) {
                return line.charAt(0) !== '#' && line.length > 0
            }).map(function( line ) {
                return line.trim()
            })
        },

        /**
         * Determines whether a commit log message contains a specified string
         * @param needle the String or RegExp for which to search in the log message
         * @param ref the ref to check. Default: HEAD
         * @param callback Optional. (err, Boolean containsString)
         * @return a promise if no callback is given
         */
        commitMsgContains: function(
            needle: string | RegExp,
            ref: string = 'HEAD',
            callback: (err: Error | null, containsString: boolean | null) => void = () => {}
        ): Q.Promise<boolean> {
            const needleRegExp = needle instanceof RegExp ? needle : new RegExp(needle)

            return exUtils.getCommitMsg(ref)
            .then( function(msg: any) {
                return needleRegExp.test(msg)
            })
            .nodeify(callback)
        },


        // NOTE: this logic may not be correct, but I've yet to check due to it currently not being used
        /**
         * Performs a glob match in the repo directory
         * @param fileGlob the glob to match against
         * @param callback Optional. (err, [String]: matching filenames)
         * @return a promise if no callback is given
         */
        filesMatching: function(
            fileGlob: string,
            callback?: (err: Error | null, matchingFilenames: string[] | null) => void
        ): Q.Promise<string[]> {
            const deferred = Q.defer<string[]>();
            const options = { cwd: repoDir, root: repoDir, silent: true };
        
            glob(fileGlob, options)
            .then((files) => {
                deferred.resolve(files);
                if (callback) {
                    callback(null, files);
                }
            })
            .catch((err) => {
                deferred.reject(err);
                if (callback) {
                    callback(err, null);
                }
            })
        
            return deferred.promise;
        },

        // todo: remove? not used
        shadowFilesMatching: function(... args: any[]) {
            return shadowFn( exUtils.filesMatching, args)
        },

        // todo: remove? used in a test file but that's also currently commented out
        /**
         * Checks for the existence of a file in the repo
         * @param fileGlob a glob describing the the file
         * @param callback Optional. (err, Boolean fileExists)
         * @return a promise if no callback is given
         */
        fileExists: function(
            fileGlob: string,
            callback: (err: Error | null, fileExists: boolean) => void = () => {}
        ): Q.Promise<boolean> {
            return exUtils.filesMatching(fileGlob)
            .then( function( files:any ) { return files.length !== 0 })
            .nodeify( callback )
        },

        // todo: remove? not used
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