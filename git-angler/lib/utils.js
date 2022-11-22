var url = require('url');

module.exports = {
    /**
     * Gets the repo path from a path containing internal Git subdirectories
     * Looking for a .git directory is unreliable since it may not be a bare repo (i.e. a work tree)
     * @param {String} reqUrl a String containing the requested repository URL
     * @return {Array} the path array to the repo base (and not the internal Git dirs)
     */
    getRepoPath: function( reqUrl ) {
        var REPO_DIRS = [ // @see man gitrepository-layout
            // it might be useful to convert this into a self-organizing list
            /\/git-receive-pack$/,
            /\/git-upload-pack$/,
            /\/info\/refs$/,
            /\/info\/grafts$/,
            /\/info\/exclude$/,
            /\/info$/,
            /\/objects\/[0-9a-f]{2}$/,
            /\/objects\/pack/,
            /\/objects\/info/,
            /\/objects\/info\/packs$/,
            /\/objects\/info\/alternates$/,
            /\/objects\/info\/http-alternates$/,
            /\/objects$/,
            /\/refs\/heads\/.*$/,
            /\/refs\/tags\/.*$/,
            /\/refs\/remotes.*$/,
            /\/refs\/replace\/[0-9a-f]+$/,
            /\/refs$/,
            /\/packed-refs$/,
            /\/HEAD$/,
            /\/branches$/,
            /\/hooks$/,
            /\/index$/,
            /\/remotes$/,
            /\/logs\/refs\/heads\/.*$/,
            /\/logs\/refs\/tags\/.*$/,
            /\/logs$/,
            /\/shallow$/
        ],
        repoUrlPath = url.parse( reqUrl ).pathname,
        i,
        re,
        dicePath = function( p ) { return p.split('/').slice( 1 ); }; // slice to remove first /

        for ( i = 0; i < REPO_DIRS.length; i++ ) {
            re = REPO_DIRS[ i ];
            if ( re.test( repoUrlPath ) ) {
                return dicePath( repoUrlPath.replace( re, '' ) );
            }
        }
        return dicePath( repoUrlPath );
    },

    callHandlerSync: function( eventBus, timeout, scope, action, args, cb ) {
        var handlerTimeout,
            doneCB = function() {
                var cbArgs = Array.prototype.slice.call( arguments );
                clearTimeout( handlerTimeout );
                cb.apply( null, cbArgs );
            };

        if ( eventBus.triggerHandler( scope, action, args.concat( doneCB ) ) ) {
            handlerTimeout = setTimeout( doneCB, timeout );
        } else {
            doneCB();
        }
    }
};
