# This part is needed by OpenStack VM:
# https://unix.stackexchange.com/questions/463498/terminate-and-disable-remove-unattended-upgrade-before-command-returns
echo waiting for unattended upgrades to finish
sudo systemd-run --property="After=apt-daily.service apt-daily-upgrade.service" --wait /bin/true

# make sure we have the latest package list
sudo DEBIAN_FRONTEND=noninteractive apt-get -y update

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
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install git mongodb-server nginx nodejs redis-server make || exit 1

# install node
curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install nodejs || exit 1

# node commands needed globally
# use sudo -H so that npm cache goes in /root rather than /home/ubuntu
sudo -H npm install -g forever || exit 1

# make Gitstream
make
sudo make install

# restart Nginx
sudo service nginx reload

# start up the Node server using forever
FOREVER_CMDLINE="cd /opt/gitstream ; forever start dist/server/main.js"
sudo su gitstream -c 'forever stopall'
sudo su gitstream -c "$FOREVER_CMDLINE" || exit 1

# put 'forever start' in crontab if it's not there already
sudo su gitstream -c "(crontab -l | grep -v 'forever start' ; echo '@reboot $FOREVER_CMDLINE') | crontab -" || exit 1
sudo su gitstream -c "crontab -l"
