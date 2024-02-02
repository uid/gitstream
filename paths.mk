# default paths
SRC := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
DEST = $(DESTDIR)/opt/gitstream
REPOS = $(DESTDIR)/srv/repos
MONGO = $(DESTDIR)/var/opt/gitstream/mongo
NGINXLOGS = $(DESTDIR)/var/log/nginx
GSLOGS = $(NGINXLOGS)/gitstream_access.log $(NGINXLOGS)/gitstream_error.log
GITSTREAM_USER := $(shell grep gitstream /etc/passwd; echo $$?)

# source paths
SRC_CLIENT_STATIC = src/client/resources/ src/client/*.html
SRC_EXERCISES = node_modules/gitstream-exercises/exercises

# destination paths
DIST_CLIENT = dist/client/
DIST_SERVER = dist/server/
DIST_EXERCISES = dist/server