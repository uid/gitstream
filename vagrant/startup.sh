# start the required daemons
redis-server /opt/gitstream/redis.conf
nginx
mongod --dbpath /var/opt/gitstream/mongo --fork --syslog
exit 0 # to prevent vagrant up from complaining when these daemons are already running
