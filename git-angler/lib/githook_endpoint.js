/*
    git-angler: a Git event bus
    Copyright (C) 2014 Nick Hynes -- MIT
*/

'use strict';

var url = require('url'),
    utils = require('./utils');

function bufferBody( req, cb ) {
    var chunks = [],
        totalLen = 0;

    req.on( 'data', function( chunk ) {
        chunks.push( chunk );
        totalLen += chunk.length;
    });

    req.on( 'error', function( err ) {
        cb( null, err );
    });

    req.on('end', function() {
        cb( Buffer.concat( chunks ).toString(), totalLen );
    });
}

function processReceiveData( updates ) {
    return [ updates.trimRight().split('\n').map( function( updateInfo ) {
        var updateParams = updateInfo.split(' ');
        return { old: updateParams[ 0 ], new: updateParams[ 1 ], name: updateParams[ 2 ] };
    }) ];
}

module.exports = function( opts ) {
    opts = opts || {};
    if ( !opts.pathToRepos || !opts.eventBus ) {
        throw Error('git-angler hook endpoint requires both a path to repos and an EventBus');
    }

    var eventBus = opts.eventBus,
        hookHandlers,
        handlerTimeoutLen = opts.handlerTimeoutLen || 30000,
        callHandlerSync = utils.callHandlerSync.bind( null, eventBus, handlerTimeoutLen );

    function handler( dataHandler ) {
        return function( hook, repo, data, res ) {
            var cbArgs = dataHandler ? dataHandler( data ) : [];
            callHandlerSync( repo, hook, cbArgs, function( exitCode, respText ) {
                var resp = ( exitCode ? exitCode.toString() : '0' ) +
                    ( respText ? '\n' + respText : '' );
                eventBus.triggerListeners( repo, hook, cbArgs );
                res.end( resp );
            });
        };
    }

    function getLocalRepo( repoPath ) {
        var TRAILING_SLASH = /\/$/,
            repoFsPathRe = new RegExp( '^' + opts.pathToRepos.replace( TRAILING_SLASH, '' ) );
        return repoPath.replace( repoFsPathRe, '' );
    }

    function getRemoteRepo( repoPath ) {
        var path = url.parse( repoPath ).pathname,
            reposMountRe = new RegExp( '^' + opts.gitHTTPMount.replace( /\/$/, '' ) );
        return path.replace( reposMountRe, '' );
    }

    hookHandlers = {
        'pre-commit': handler( function( logMsg ) {
            return [ { logMsg: logMsg } ];
        }),
        commit: handler(),
        'pre-rebase': handler(),
        checkout: handler( function( data ) {
            var params = data.split(' ');
            return [ { prevHead: params[ 0 ], newHead: params[ 1 ], chBranch: !!params[ 2 ] } ];
        }),
        merge: handler( function( data ) {
            var wasSquash = data === 'true' || data === true;
            return [ { wasSquash: wasSquash } ];
        }),
        'pre-receive': handler( processReceiveData ),
        receive: handler( processReceiveData )
    };

    return function( req, res ) {
        if ( req.method !== 'POST' ) {
            res.writeHead( 405, 'Unsupported method on POST only resource' );
            res.end();
            return;
        }

        var parsedUrl = url.parse( req.url, true ),
            hook = parsedUrl.query.hook,
            repoPath = parsedUrl.query.repo,
            repoPathParser,
            repoStr;

        if ( parsedUrl.pathname === '/' ) {
            if ( hookHandlers[ hook ] && repoPath ) {
                repoPathParser = hook.indexOf('receive') !== -1 ? getLocalRepo : getRemoteRepo;
                repoStr = repoPathParser( repoPath )
                    .replace( /\/\.git$/, '' ); // remove the trailing .git from receive hooks
                bufferBody( req, function( body ) {
                    hookHandlers[ hook ]( hook, repoStr, body, res );
                });
            } else if ( hook && repoPath ) {
                res.writeHead( 400, 'Invalid hook type' );
                res.end();
            } else if ( repoPath ) {
                res.writeHead( 400, 'Required query parameter: hook' );
                res.end();
            } else if ( hook ) {
                res.writeHead( 400, 'Required query parameter: repo' );
                res.end();
            } else {
                res.writeHead( 400, 'Required query parameters: hook, repo' );
                res.end();
            }
        } else {
            res.writeHead( 404 );
            res.end();
        }
    };
};
