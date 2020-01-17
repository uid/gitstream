#!/usr/bin/make -f

SRC := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
DEST = $(DESTDIR)/opt/gitstream
GSDIRS = $(DEST) $(DESTDIR)/srv/repos $(DESTDIR)/var/opt/gitstream/mongo
NGINXLOGS = $(DESTDIR)/var/log/nginx
GSLOGS = $(NGINXLOGS)/gitstream_access.log $(NGINXLOGS)/gitstream_error.log
GITSTREAM_USER := $(shell grep gitstream /etc/passwd; echo $$?)

build:
ifeq ($(PACKAGING),)
	npm install
endif
	NODE_ENV=production node node_modules/gulp/bin/gulp.js build	

install:
	npm prune --production
	mkdir -p $(GSDIRS) $(NGINXLOGS)
ifneq ($(DEST), $(SRC))
	cp -R dist $(DEST)
	cp -R node_modules $(DEST)
	cp nginx-deployed.conf $(DEST)/nginx.conf
	cp redis.conf $(DEST)
endif
	touch $(GSLOGS)

ifeq ($(PACKAGING),)
ifeq ($(GITSTREAM_USER), 1)
	useradd -m gitstream
	chown -R gitstream:gitstream $(GSDIRS) $(GSLOGS)
	su gitstream -lc 'git config --global user.email "gitstream@gitstream.csail.mit.edu"'
	su gitstream -lc 'git config --global user.name "GitStream"'
endif
	ln -sf /opt/gitstream/nginx-deployed.conf /etc/nginx/nginx.conf
endif

uninstall:
	rm -rf $(GSDIRS) $(GSLOGS) $(DESTDIR)/var/opt/gitstream
	sudo su gitstream -lc 'kill -15 -1'
	-userdel -r gitstream > /dev/null 2>&1

clean:
	rm -rf dist

distclean: clean;
