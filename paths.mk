# default paths
SRC := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
DEST = $(DESTDIR)/opt/gitstream
GSDIRS = $(DEST) $(DESTDIR)/srv/repos $(DESTDIR)/var/opt/gitstream/mongo
NGINXLOGS = $(DESTDIR)/var/log/nginx
GSLOGS = $(NGINXLOGS)/gitstream_access.log $(NGINXLOGS)/gitstream_error.log
GITSTREAM_USER := $(shell grep gitstream /etc/passwd; echo $$?)