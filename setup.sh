# This part is needed by OpenStack VM:
# https://unix.stackexchange.com/questions/463498/terminate-and-disable-remove-unattended-upgrade-before-command-returns
echo waiting for unattended upgrades to finish
sudo systemd-run --property="After=apt-daily.service apt-daily-upgrade.service" --wait /bin/true

# make sure we have the latest package list
sudo DEBIAN_FRONTEND=noninteractive apt-get -y update

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
