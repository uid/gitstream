# start the required daemons
redis-server /opt/gitstream/redis.conf
nginx
mongod --dbpath /var/opt/gitstream/mongo --fork --syslog
