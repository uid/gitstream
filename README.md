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
