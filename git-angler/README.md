# Git Angler - A Git event bus

This event bus acts as a hub for Git events by listening to git-http traffic and processing events sent by in-repo githooks. The event bus is, therefore, used to serve the git repos via http(s).

            git-http             git-http
    Client <--------> Event Bus <--------> Requested repository
      |__________________^ ^_________________________|
         githook events           githook events

As previously mentioned, there are two components: the git-http listener and the REST hook listener.

## git-http listener

Used to capture the following events:
    * (pre-)pull
    * (pre-)info
    * (pre-)clone
    * (pre-)push

## REST hook listener

Events sent from local (client) repo with hooks installed:
    * merge
    * pre-rebase
    * (pre|post)-commit
    * post-checkout
    * (pre-)receive


## Testing
Run `npm test`