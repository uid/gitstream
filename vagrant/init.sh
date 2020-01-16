# install required packages
apt-get update
curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
apt-get -y install git mongodb-server nginx nodejs redis-server make

# make the repos and database directory
mkdir -p /srv/repos /var/opt/gitstream/mongo

# create gitstream user and give it perms
useradd -m gitstream
chown -R gitstream:gitstream /srv/repos /var/log/nginx /var/opt/gitstream

# add the vagrant user to gitstream for convenience
usermod -G gitstream vagrant

# move the nginx config file into place and stop the server
ln -fs /opt/gitstream/nginx.conf /etc/nginx/nginx.conf
killall nginx

# set up gitstream git config to prevent stupid complaining by git
su gitstream -c 'git config --global user.email "gitstream@csail.mit.edu"'
su gitstream -c 'git config --global user.name "GitStream"'

# build gitstream if it hasn't already been built
if [ ! -d "/opt/gitstream/dist" ]; then
    cd /opt/gitstream
    make build
fi
