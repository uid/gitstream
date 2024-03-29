# GitStream - An interactive Git tutorial system

## Installation

### Ubuntu

>**Warning:** Deprecated.

```sh
sudo add-apt-repository ppa:gitstream/gitstream
sudo apt-get update && sudo apt-get install gitstream
``` 

### General

Download and access GitStream repository:
```sh
git clone https://github.com/uid/gitstream.git
cd gitstream
```

Install development dependencies:
* Node.js v22
* apt packages: `git nginx nodejs make`
* MongoDB Community Edition


Build and install GitStream:
```sh
make install
```

Make sure certs are in their appropriate locations (see nginx-deployed.conf for the locations):
```sh
sudo service nginx reload
sudo -u gitstream pm2 start dist/server/main.js
```

## Development

### Install Dependencies
1. Download [GitStream Excercises](https://github.com/uid/gitstream-exercises) repository and
place inside the root folder of GitStream.
2. Install [Vagrant](https://www.vagrantup.com/).
3. Add a new Vagrant box to your machine: `vagrant box add ubuntu/focal64`.
4. Ensure special configuration files are in the main directory: `gistream.pem`, `settings.js`

### Test

* Run test cases via `npm test`.
* To locally test multiple users, comment out `openid` config in `settings.js`. 

### Run

1. Access the VM by entering the vagrant folder (`cd vagrant`) and running `vagrant up && vagrant ssh`.
The first boot will be slow as the VM is being initialized.

2. Once in the VM, head to the gitstream directory: `cd /opt/gitstream`.

3. Whenever you edit the sourcecode, rebuild and restart the server by running `make run`.

4. You can now view GitStream by navigating your browser to one of the exercises,
e.g.: [http://localhost:8000?theGitGo](http://localhost:8000?theGitGo).

### Misc. Debugging
* MIT's OpenID is not friendly with VPNs. Make sure your VPN is disabled when accessing the GitStream webpage.
