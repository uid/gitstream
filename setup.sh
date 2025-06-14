# This part is needed by OpenStack VM:
# https://unix.stackexchange.com/questions/463498/terminate-and-disable-remove-unattended-upgrade-before-command-returns
echo waiting for unattended upgrades to finish
sudo systemd-run --property="After=apt-daily.service apt-daily-upgrade.service" --wait /bin/true

# make sure we have the latest package list
sudo DEBIAN_FRONTEND=noninteractive apt -y update

# install certbot first, so we can set up persistent volume first
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# set up the persistent volume
if sudo file -s /dev/vdb | grep '/dev/vdb: data'
then
    # format the volume and copy over the starting contents of /etc/letsencrypt
    sudo mkdir /tmp/persistent
    sudo cp -a /etc/letsencrypt /tmp/persistent
    sudo mkfs.ext4 -L persistent -d /tmp/persistent /dev/vdb || exit 1
    sudo rm -rf /tmp/persistent
else
    echo 
    # confirm that it's the persistent volume and not some other volume
    if sudo file -s /dev/vdb | grep 'volume name "persistent"'
    then echo persistent volume is already initialized
    else
        echo /dev/vdb volume has unexpected filesystem on it:
        sudo file -s /dev/vdb
        exit 1
    fi
fi

# define its mountpoint
sudo mkdir -p /mnt/persistent
if grep 'persistent' /etc/fstab
then echo fstab already has entry for persistent volume
else
    sudo sh -c "echo 'LABEL=persistent   /mnt/persistent        ext4    defaults        0 0' >> /etc/fstab" || exit 1
    echo fstab entry added
fi

# mount the persistent volume and symlink to it
sudo mount -a || exit 1
if [ ! -L /etc/letsencrypt ]
then
    sudo mv /etc/letsencrypt /etc/letsencrypt.orig
    sudo ln -sf /mnt/persistent/letsencrypt /etc/letsencrypt
fi
echo created symlinks to /mnt/persistent

# install Linux packages
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt -y install git nginx make || exit 1

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
sudo systemctl start mongod.service

# node commands needed globally
# use sudo -H so that npm cache goes in /root rather than /home/ubuntu
sudo -H npm install -g pm2 || exit 1

# make Gitstream
make install

# restart Nginx
sudo systemctl restart nginx

# start up the Node server using pm2
sudo su gitstream -c 'pm2 delete all'
sudo su gitstream -c "cd /opt/gitstream ; pm2 --name gitstream start dist/server/main.js" || exit 1
sudo su gitstream -c 'pm2 save'

# start server in crontab if it's not there already
sudo su gitstream -c "(crontab -l | grep -v pm2 ; echo '@reboot sleep 10 ; pm2 resurrect') | crontab -" || exit 1
sudo su gitstream -c "crontab -l"
