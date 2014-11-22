# start the required daemons
redis-server /opt/gitstream/redis.conf
nginx
mongod --dbpath /opt/mongo --fork --syslog
