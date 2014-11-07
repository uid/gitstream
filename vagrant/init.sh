# set mysql password for happy, non-interactive installation
echo "mysql-server-5.6 mysql-server/root_password password root" | debconf-set-selections
echo "mysql-server-5.6 mysql-server/root_password_again password root" | debconf-set-selections

# install required packages
apt-get update
# apt-get -y upgrade
apt-get -y install git mariadb-server nginx nodejs npm redis-server

# link nodejs to node
ln -s /usr/bin/nodejs /usr/bin/node

# set up mysql
mysql -proot -e "
CREATE DATABASE gitstream CHARACTER SET utf8;
USE gitstream;
CREATE TABLE users (
    name                VARCHAR(12) NOT NULL PRIMARY KEY,
    gitkey              CHAR(40)
);
"

# make the repos directory
mkdir /srv/repos

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
su gitstream -c 'git config --global user.email "nhynes@mit.edu"'
su gitstream -c 'git config --global user.name "Nick Hynes"'

# build gitstream if it hasn't already been built
if [ ! -d "/opt/gitstream/dist" ]; then
    cd /opt/gitstream
    npm install --production
    NODE_ENV=production node ./node_modules/gulp/bin/gulp build
fi

