# install required packages
apt-get update
apt-get -y install git mongodb nginx nodejs npm redis-server

# link nodejs to node
ln -s /usr/bin/nodejs /usr/bin/node

# make the repos directory
mkdir /srv/repos

# make the mongodb db directory
mkdir /var/opt/gitstream/mongo

# create gitstream user and give it perms
useradd -m gitstream
chown -R gitstream:gitstream /srv/repos
chown -R gitstream:gitstream /var/log/nginx

# add the vagrant user to gitstream for convenience
usermod -G gitstream vagrant

# move the nginx config file into place and restart the server
ln -fs /opt/gitstream/nginx.conf /etc/nginx/nginx.conf
killall nginx

# set up gitstream git config to prevent stupid complaining by git
su gitstream -c 'git config --global user.email "gitstream@csail.mit.edu"'
su gitstream -c 'git config --global user.name "GitStream"'

# build gitstream if it hasn't already been built
if [ ! -d "/opt/gitstream/dist" ]; then
    cd /opt/gitstream
    npm install --production
    NODE_ENV=production node ./node_modules/gulp/bin/gulp build
fi
