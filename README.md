# GitStream - An interactive Git tutor

## Installation

### Ubuntu

```
$ sudo add-apt-repository ppa:gitstream/gitstream
$ sudo apt-get update && sudo apt-get install gitstream
```

### General

Start by installing git, mongodb, nginx, node, npm, and redis-server.

```
$ git clone https://github.com/uid/gitstream.git && cd gitstream
$ make && sudo make install && cd /opt/gitstream
$ sudo nginx
$ sudo su gitstream
$ mongod --dbpath /var/opt/gitstream/mongo --fork --syslog
$ redis-server redis.conf
$ node node_modules/forever/bin/forever start dist/server/main.js
```

Navigate your browser to your server and GitStream away!

## Development

For active development, you will want to have node and npm installed on your system.  
If you only want to work inside of the VM, omit the initial `make`.

```
$ make
$ cd vagrant
$ vagrant up && vagrant ssh
```

Once in the VM, start the server by running

```
$ sudo su gitstream
$ node /opt/gitstream/dist/server/main
```

You can now view GitStream by navigating your browser to [http://localhost:8080](http://localhost:8080).

To re-build GitStream when changes are made, `npm install -g gulp` and run `gulp` from somewhere within the project directory. You will have to manually restart the server after editing anything in src/server.
