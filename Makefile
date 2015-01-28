#!/usr/bin/make -f

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
	mkdir -p $(GSDIRS) $(NGINXLOGS)
	cp -R dist $(DEST)
	cp -R node_modules $(DEST)
	cp nginx.conf $(DEST)
	cp redis.conf $(DEST)
	touch $(GSLOGS)

ifeq ($(PACKAGING),)
ifeq ($(GITSTREAM_USER), 1)
	useradd -m gitstream
	chown -R gitstream:gitstream $(GSDIRS) $(GSLOGS)
	su gitstream -lc 'git config --global user.email "gitstream@gitstream.csail.mit.edu"'
	su gitstream -lc 'git config --global user.name "GitStream"'
endif
	ln -sf /opt/gitstream/nginx.conf /etc/nginx/nginx.conf
endif

uninstall:
	rm -rf $(GSDIRS) $(GSLOGS) $(DESTDIR)/var/opt/gitstream
	sudo su -lc 'kill -15 -1'
	-userdel -r gitstream > /dev/null 2>&1

clean:
ifeq ($(PACKAGING),)
	rm -rf node_modules
endif
	rm -rf dist

distclean: clean;
