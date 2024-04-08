import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import q from 'q';
import mustache from 'mustache';
import crypto from 'crypto';

import settings from '../../settings.js';


// todo: verify types are right
type FileSpec = {
    src?: string; // Path to file relative to `srcBase`. Leave blank when creating new files.
                  // Can be a directory (will be recursively templated/written out)
    dest: string; // path to destination relative to `repo`. Will recursively create dirs.
    template?: Object | ((srcPath: string) => Object); // The template for file content generation.
        // It can be either:
        // 1. A static Mustache template object for predefined templating.
        // 2. A function for creating templates dynamically based on the source file.
        // If `src` is undefined (no source file), the template is optional and can be skipped.
};
  

export type CommitSpec = {
    msg: string;
    author?: string; // Optional because a default value should be set
    date?: Date; // Optional because a default value should be set
    files: Array<string | FileSpec>;
        // if `string`, copies from src to dest. Assumes same directory structure
        // if `FileSpec`, refers to a FileSpec
};

export let utils = {
    /**
     * Converts events in dash-delimited format to properties of the form onEventName
     * @param prefixesArg - the prefix of the propified events. Default: 'on'
     * @param eventsArg - the events to propify. Optional - defaults to `prefixesArg`
     * @return a hash from onEventName to event-name strings
     */
    events2Props: function(prefixesArg: Array<any>, eventsArg?: Array<any> ) { // todo: change the strings to another type?
        const prefixes = eventsArg ? prefixesArg : [ 'on' ],
            events = eventsArg ? eventsArg : prefixesArg

        return events.reduce( function( propHash, event ) {
            const eventPropSuffix = event.split('-').map( function( eventIdentifier: string ) {
                    return eventIdentifier.slice( 0, 1 ).toUpperCase() + eventIdentifier.slice( 1 )
                }).join('')
            prefixes.map( function( prefix ) {
                const eventProp = prefix + eventPropSuffix
                propHash[ eventProp ] = event
            })
            return propHash;
        }, {} )
    },

    /**
     * Executes a git command in a specified repo
     * @param repo the path to the repository in which to execute the command
     * @param cmd the git command to run
     * @param args the arguments to pass to the command
     * @return a promise on the completion of the command
     */
    git: function(repo: string, cmd: string, args: String | Array<string> ): Q.Promise<any> {
        return q.nfcall( fs.stat, repo )
        .then( function() {
            const done = q.defer(),
                cmdArgs = ( args instanceof Array ? args : args.trim().split(' ') ),
                unused = console.log('running git', cmd, cmdArgs, repo),
                git = spawn( 'git', [ cmd ].concat( cmdArgs ), { cwd: repo } );
            
            let output = '',
                errOutput = '';

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
     * @param dirPath - the path to the directory to make
     * @param base - the directory in which to create the tree. Default: `/`
     * @return a promise
     */
    mkdirp: function(dirPath: string, base: string = '/'): Q.Promise<any> {
        const rel = base,
            dirs = Array.isArray( dirPath ) ? dirPath : dirPath.split( path.sep ),
            theDir = path.join( rel, dirs.shift() || '' ),
            mkChildDir = dirs.length === 0 ? function() {} : utils.mkdirp.bind( null, <any>dirs, theDir ) // todo: confused what dirs should be here

        return q.nfcall( fs.stat, theDir )
        .then( mkChildDir, function( e ) {
            if ( e.code === 'ENOENT' ) {
                return q.nfcall( fs.mkdir, theDir ).then( mkChildDir )
                .catch( function( e ) { if ( e.code !== 'EEXIST' ) { throw e } } )
            }
            throw e
        })
    },

    /**
     * Templates a file and writes it out
     * @param src - the path to the source file/dir. Leave blank to create new file.
     * @param dest - the path to the output file/dir (only file if `src` is unspecified)
     * @param template - a template object a la mustache
     * @return a promise
     */
    writeOut: function(src: string, dest: string, template: any ): Q.Promise<any> { // tood: fix any type
        if ( !src ) {
            return utils.mkdirp(path.dirname( dest ))
            .then( q.nfcall.bind( null, fs.writeFile, dest, '' ) )
        }

        return q.nfcall( fs.stat, src )
        .then( function( stats: fs.Stats ) {
            const srcPath = path.join.bind( null, src ),
                  destPath = path.join.bind( null, dest )

            if ( stats.isDirectory() ) { // recursiely template and write out directory
                return q.nfcall( fs.mkdir, dest ) // make the dest directory
                .then( function() {
                    return q.nfcall( fs.readdir, src ) // recurse into the src dir
                })
                .then( function( dirContents: string[] ) {
                    return q.all( dirContents.map( function( file ) {
                        return utils.writeOut( srcPath( file ), destPath( file ), template )
                    }) as any )
                } as (value: unknown) => unknown) // todo: fix later
            } else {
                return q.nfcall( fs.readFile, src, { encoding: 'utf8' } )
                .then( function( file: string ) {
                    const fileTemplate = typeof template === 'function' ? template( src ) : template,
                          templated = mustache.render( file, fileTemplate )
                    return utils.mkdirp( path.dirname( dest ) )
                    .then( q.nfcall.bind( null, fs.writeFile, dest, templated ) )
                } as (value: unknown) => unknown) // todo: fix later
            }
        } as (value: unknown) => unknown) // todo: fix later
    },



    

    /**
     * Adds the specified files (possibly templated) to the given repo and commits them
     * @param repo - the path to the repository. Dest files are relative to the repo root
     * @param srcBase - path to which src files paths are relative. Default: `/`
     * @param spec - the specification for the commit
     * 
     * @return - a promise on the completion of the commands
     */
    addCommit: function( repo: string, srcBase: string = '/', spec: CommitSpec ): Q.Promise<any> {
        const srcPath = path.join.bind( null, srcBase ),
            destPath = path.join.bind( null, repo ),
            commitAuthor = spec.author ||'GitStream <gitstream@csail.mit.edu>',
            commitDate = ( spec.date || new Date() ).toISOString(),
            commitMsg = spec.msg.replace( /'/g, '\\"' ),
            filesToStage: string[] = []

        return q.all( spec.files.map( function( fileSpec: FileSpec ) {
            // todo: this whole part is sus, update
            const srcArg = typeof fileSpec === 'string' ? fileSpec : fileSpec.src, // todo: change typeof check?
                  src = srcArg ? srcPath( srcArg ) : '',
                  dest = typeof fileSpec === 'string' ? fileSpec : fileSpec.dest || fileSpec.src,
                  template = typeof fileSpec === 'string' ? {} : fileSpec.template

            filesToStage.push( ':' + dest )

            return utils.writeOut( src, destPath( <any>dest ), template ) // todo: once above done, change any
        } as (value: unknown) => unknown) ) // todo: fix later
        .then( function() {
            if (filesToStage.length == 0) {
                return Promise.resolve();
            } else {
                return utils.git( repo, 'add', filesToStage.join(' ') )
            }
        })
        .then( function() {
            return utils.git( repo, 'commit', [
                '-m', commitMsg,
                '--author="' + commitAuthor + '"',
                '--date=' + commitDate
            ])
        })
    },

    // errorCallback: Error -> void, called only when there is an error;
    //     may be called more than once
    exportToOmnivore: function(userId: string, exerciseName: string, errorCallback: (error: Error) => void) {
        try {
            if (!exerciseName) {
                return;
            }

            interface OmnivoreEndpoint {
                url: string; // something like "https://omni.mit.edu/<course>/<sem>/api/v2/multiadd"
                key: string; // something like "/classes/..."
            }
              
            const omnivoreEndpoints: OmnivoreEndpoint[] = settings.omnivoreEndpointsForExercise(exerciseName);
            
            console.log(userId, 'completed', omnivoreEndpoints);

            omnivoreEndpoints.forEach(function( omnivoreEndpoint ) {
                const record = {
                    username: userId,
                    key: omnivoreEndpoint.key,
                    ts: new Date(),
                    value: true, // filler
                }

                const input = [ record ]
                
                let sign = crypto.createSign('RSA-SHA256')
                sign.update(JSON.stringify(input))
                
                const privateKey = fs.readFileSync(settings.pemPath);
                const signature = sign.sign(privateKey, 'base64')
                
                const url = omnivoreEndpoint.url;
                const headers = { 
                    'Content-Type': 'application/json',
                    'X-Omnivore-Signed': 'gitstream ' + signature 
                };
                const body = JSON.stringify(input);
                
                fetch(url, {
                    method: 'POST',
                    headers,
                    body
                }).then(response => {
                    console.log('Omnivore responded', response.status, response.statusText);

                    if (!response.ok) {
                        throw new Error(`Request failed with status ${response.status}`); 
                    }
                }).catch(error => {
                    errorCallback(error); 
                });
            });
        } catch (e) {
            return errorCallback(e as Error); // todo: change?
        }        
    }
}
