# install required packages
sudo apt-get update

# install node from https://github.com/nodesource/distributions#installation-instructions
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates gnupg || exit 1
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg
NODE_MAJOR=18
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install nodejs || exit 1

# install MongoDB Community Edition
wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb-org || exit 1
sudo systemctl enable mongod.service

# make the repos and database directory
sudo mkdir -p /srv/repos /var/opt/gitstream/mongo

# create gitstream user and give it perms
sudo useradd -m gitstream
sudo chown -R gitstream:gitstream /srv/repos /var/log/nginx /var/opt/gitstream

# add the vagrant user to gitstream for convenience
sudo usermod -G gitstream vagrant

# move the nginx config file into place and stop the server
sudo ln -fs /opt/gitstream/nginx-dev.conf /etc/nginx/nginx.conf
sudo killall nginx

# set up gitstream git config to prevent stupid complaining by git
sudo -u gitstream git config --global user.email "gitstream@csail.mit.edu"
sudo -u gitstream git config --global user.name "GitStream"

# build gitstream if it hasn't already been built
if [ ! -d "/opt/gitstream/dist" ]; then
    cd /opt/gitstream
    make build
fi
