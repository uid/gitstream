/*
    git-angler: a Git event bus
    Copyright (C) 2014 Nick Hynes -- MIT
*/

'use strict';

var gitBackend = require('./lib/git_http_backend'),
    githookEndpoint = require('./lib/githook_endpoint'),
    EventBus = require('./lib/EventBus');

module.exports = {
    gitHttpBackend: gitBackend,
    githookEndpoint: githookEndpoint,
    EventBus: EventBus,
};
