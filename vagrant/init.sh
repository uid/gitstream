# install required packages
apt-get update
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
apt-get -y install git nginx nodejs redis-server make

# install MongoDB Community Edition
wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb-org || exit 1
sudo systemctl enable mongodb.service

# make the repos and database directory
mkdir -p /srv/repos /var/opt/gitstream/mongo

# create gitstream user and give it perms
useradd -m gitstream
chown -R gitstream:gitstream /srv/repos /var/log/nginx /var/opt/gitstream

# add the vagrant user to gitstream for convenience
usermod -G gitstream vagrant

# move the nginx config file into place and stop the server
ln -fs /opt/gitstream/nginx-dev.conf /etc/nginx/nginx.conf
killall nginx

# set up gitstream git config to prevent stupid complaining by git
su gitstream -c 'git config --global user.email "gitstream@csail.mit.edu"'
su gitstream -c 'git config --global user.name "GitStream"'

# build gitstream if it hasn't already been built
if [ ! -d "/opt/gitstream/dist" ]; then
    cd /opt/gitstream
    make build
fi
