# GitStream - An interactive Git tutorial system

## Installation

### Ubuntu

Note: this section will soon be deprecated.

```
sudo add-apt-repository ppa:gitstream/gitstream
sudo apt-get update && sudo apt-get install gitstream
```

### General

Download and access gitstream repository:
```
git clone https://github.com/uid/gitstream.git
cd gitstream
```

Install development dependencies:

```
sudo apt-get update
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get -y install git nginx nodejs redis-server make
```

Install [MongoDB Community Edition](https://docs.mongodb.com/manual/administration/install-community/).


Install gitstream's dependencies:
```
make
sudo make install
cd /opt/gitstream
```

Make sure certs are in their appropriate locations (see nginx-deployed.conf for the locations):
```sh
sudo service nginx reload
sudo -u gitstream pm2 start dist/server/main.js
```

Now you're all set!

## Development

### Install Dependencies
1. Download [GitStream Excercises](https://github.com/uid/gitstream-exercises) repository and place inside the root folder of GitStream.
2. Install [Vagrant](https://www.vagrantup.com/)
3. Add a new Vagrant box to your machine: `vagrant box add ubuntu/focal64`

### Test
Run test cases via `npm test`.

### Run

Access the VM by running:
```sh
cd vagrant
vagrant up && vagrant ssh
```

Once in the VM, head to the gitstream directory: `cd /opt/gitstream`

Whenever you edit the sourcecode, rebuild and restart the server by running:
```sh
make; sudo -u gitstream node dist/server/main
```

You can now view GitStream by navigating your browser to one of the exercises, e.g.: [http://localhost:8000?theGitGo](http://localhost:8000?theGitGo).