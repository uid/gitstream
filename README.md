# GitStream - An interactive Git tutor

## Installation

### Ubuntu

```
sudo add-apt-repository ppa:gitstream/gitstream
sudo apt-get update && sudo apt-get install gitstream
```

### General

```
git clone https://github.com/uid/gitstream.git
cd gitstream
```

```
sudo apt-get update
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt-get -y install git nginx nodejs redis-server make
```

Install [MongoDB Community Edition](https://docs.mongodb.com/manual/administration/install-community/).

```
make
sudo make install
cd /opt/gitstream
```

```
# make sure certs are in their appropriate locations
# (see nginx-deployed.conf for the locations)
sudo service nginx reload
```

```
sudo su gitstream -c 'node_modules/forever/bin/forever start dist/server/main.js'
```

Navigate your browser to your server and GitStream away!

## Development

For active development, you will want to have node and npm installed on your system.  
If you only want to work inside of the VM, omit the initial `make`.

```
make
cd vagrant
vagrant up && vagrant ssh
```

Once in the VM, rebuild and start the server by running

```
cd /opt/gitstream ; \
node node_modules/gulp/bin/gulp.js build ; \
sudo su gitstream -c 'node dist/server/main'
```

You can now view GitStream by navigating your browser to one of the exercises, e.g.:

[http://localhost:8000?theGitGo](http://localhost:8000?theGitGo).

You will have to rebuild and restart the server after editing anything in src/server.
