# install required packages
sudo apt-get update
sudo apt-get -y install git nginx make

# install node from https://github.com/nodesource/distributions#installation-instructions
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates gnupg || exit 1
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg
NODE_MAJOR=20
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install nodejs || exit 1

# install MongoDB Community Edition
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --yes -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
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
