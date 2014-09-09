module.exports = {
    /**
     * Converts events in dash-delimited format to properties of the form onEventName
     * @param {String...} events the events to propify
     * @return {Object} a hash from onEventName to event-name strings
     */
    events2Props: function() {
        var events = Array.prototype.slice.call( arguments );
        return events.reduce( function( propHash, event ) {
            var eventProp = 'on' + event.split('-').map( function( eventIdentifier ) {
                return eventIdentifier.slice( 0, 1 ).toUpperCase() + eventIdentifier.slice( 1 );
            }).join('');
            propHash[ eventProp ] = event;
            return propHash;
        }, {} );
    }
};
