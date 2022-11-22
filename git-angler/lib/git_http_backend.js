/*
    git-angler: a Git event bus
    Copyright (C) 2014 Nick Hynes -- MIT
*/

'use strict';

var fs = require('fs'),
    gitHttpBackend = require('git-http-backend'),
    path = require('path'),
    spawn = require('child_process').spawn,
    stream = require('stream'),
    utils = require('./utils'),
    zlib = require('zlib');

module.exports = function( opts ) {
    opts = opts || {};
    if ( !opts.pathToRepos || !opts.eventBus ) {
        throw Error('git-angler backend requires both a path to repos and an EventBus');
    }

    var eventBus = opts.eventBus,
        pathToRepos = opts.pathToRepos,
        authenticator = opts.authenticator || function( _, cb ) { cb({ ok: true }); },
        handlerTimeoutLen = opts.handlerTimeoutLen || 30000;

    return function( req, res ) {
        var repoPath = utils.getRepoPath( req.url ),
            repoPathStr = '/' + repoPath.join('/'),
            repoFullPath = path.resolve.bind( null, pathToRepos ).apply( null, repoPath ),
            backend,
            gitService,
            encoding = req.headers['content-encoding'],
            decompress = ( encoding === 'gzip' || encoding === 'deflate' ?
                          zlib.createUnzip() : stream.PassThrough() ),
            callHandlerSync = utils.callHandlerSync
                .bind( null, eventBus, handlerTimeoutLen, repoPathStr );

        function createBackend( serviceHook ) {
            return gitHttpBackend( req.url, function( err, service ) {
                var ps,
                    authParams;

                if ( err ) {
                    res.writeHead( 400 );
                    res.end();
                    return;
                }

                authParams = {
                    request: {
                        url: req.url,
                        method: req.method,
                        headers: req.headers
                    },
                    service: {
                        action: service.action,
                        fields: service.fields
                    },
                    repoPath: repoPath
                };

                authenticator( authParams, function( auth ) {
                    if ( !auth.ok ) {
                        res.writeHead( auth.status || 401 );
                        res.end( auth.message );
                        return;
                    }

                    res.setHeader( 'Content-Type', service.type );

                    gitService = service;

                    res.on( 'finish', function() {
                        eventBus.trigger( repoPathStr, gitService.action, [ gitService.fields ] );
                    });

                    serviceHook( service, function() {
                        ps = spawn( service.cmd, service.args.concat( repoFullPath ) );
                        ps.stdout.pipe( service.createStream() ).pipe( ps.stdin );
                        ps.stderr.on( 'data', function( data ) {
                            eventBus.trigger( repoPathStr, 'err', [ data.toString() ] );
                        });
                    });
                });
            });
        }

        fs.stat( repoFullPath, function( err ) {
            if ( err ) {
                if ( err.code !== 'ENOENT' ) { return eventBus.trigger( 'error', err ); }

                callHandlerSync( '404', [ {} ], function( clonable ) {
                    if ( !clonable ) {
                        res.writeHead( 404 );
                        res.end();
                        return;
                    }

                    backend = createBackend( function( service, done ) {
                        eventBus.triggerListeners( repoPathStr, '404' );
                        done();
                    });
                    req.pipe( decompress ).pipe( backend ).pipe( res );
                });
                return;
            }

            backend = createBackend( function( service, done ) {
                var action = service.action,
                    cbArgs = [ service.fields ];
                callHandlerSync( 'pre-' + action, cbArgs, function( responseText ) {
                    if ( action !== 'info' && responseText ) {
                        service.createBand().end( responseText + '\n' );
                    }
                    eventBus.triggerListeners( repoPathStr, 'pre-' + action, [ service.fields ] );
                    done();
                });
            });
            req.pipe( decompress ).pipe( backend ).pipe( res );
        });
    };
};
