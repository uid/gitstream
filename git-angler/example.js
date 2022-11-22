/*
    git-angler: a Git event bus
    Copyright (C) 2014 Nick Hynes

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

var net = require('net'),
    connect = require('connect'),
    compression = require('compression'),
    dnode = require('dnode'),
    gitBackend = require('./lib/git_http_backend'),
    githookEndpoint = require('./lib/githook_endpoint'),
    EventBus = require('./lib/EventBus'),
    shoe = require('shoe');

function GitAngler( opts ) {
    if ( !(this instanceof GitAngler) ) { return new GitAngler( opts ); }

    this.opts = opts;

    this.opts.gitHTTPMount = opts.gitHTTPMount || '/repos';
    this.opts.hookEndpoint = opts.hookEndpoint || '/hooks';
    this.opts.eventsMount = opts.eventsMount || '/events';
}

GitAngler.prototype = {
    start: function() {
        var angler = connect(),
            server,
            eventsServer,
            wsEventsEndpoint,
            eventBus = new EventBus(),
            backend,
            hookEndpoint,
            eventBusRPCs = {
                addListener: eventBus.addListener.bind( eventBus ),
                setHandler: eventBus.setHandler.bind( eventBus ),
                removeListener: eventBus.removeListener.bind( eventBus )
            };

        this.opts.eventBus = eventBus;

        backend = gitBackend( this.opts );
        hookEndpoint = githookEndpoint( this.opts );

        angler.use( compression() );

        angler.use( this.opts.gitHTTPMount, backend );
        angler.use( this.opts.hookEndpoint, hookEndpoint );

        server = angler.listen( this.opts.port );

        wsEventsEndpoint = shoe( function( stream ) {
            var d = dnode( eventBusRPCs );
            d.pipe( stream ).pipe( d );
        }).install( server, this.opts.eventsMount );

        eventsServer = net.createServer( function( socket ) {
            var d = dnode( eventBusRPCs );
            socket.pipe( d ).pipe( socket );
        }).listen( this.opts.eventsPort );

        return {
            eventBus: eventBus,
            server: server,
            eventsServer: eventsServer,
            wsEventsEndpoint: wsEventsEndpoint
        };
    }
};

module.exports = GitAngler;
