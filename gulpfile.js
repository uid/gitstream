var gulp = require('gulp'),
    browserify = require('browserify'),
    buffer = require('vinyl-buffer'),
    cache,
    concat = require('gulp-concat'),
    hbsfy = require('hbsfy'),
    plumber,
    prefixer = require('gulp-autoprefixer'),
    sass = require('gulp-sass')(require('sass')),
    source = require('vinyl-source-stream'),

    devMode = process.env.NODE_ENV === 'development',

    path = {
        src: {
          client: {
            main: './src/client/js/main.js',
            scss: 'src/client/**/*.s[ac]ss'
          }
        },
        dist: {
          base: 'dist/',
          client: 'dist/client/'
        }
    };

if ( devMode ) {
    cache = require('gulp-cached');
    plumber = require('gulp-plumber');
}

// todo: Convert to an npm script to compile Sass. Make use of the package `node-sass`
gulp.task( 'sass', function() {
    var stream = gulp.src( path.src.client.scss )

    if ( devMode ) {
        stream = stream
            .pipe( plumber() )
    }

    return stream.pipe( sass() )
        //.pipe( minifyCss({ cache: true }) )
        .pipe( concat('bundle.css') )
        .pipe( prefixer('> 5%') )
        .pipe( gulp.dest( path.dist.client ) );
});


// todo: Convert to an npm script to bundle JS with `esbuild`
gulp.task( 'browserify', function() {
    var bundler = browserify({
        cache: {}, packageCache: {}, fullPaths: true,
        entries: path.src.client.main,
        debug: devMode
    });

    var bundle = function() {
        var stream = bundler.bundle()
            .on( 'error', function( e ) {
                console.error( '\x1b[31;1m', 'Browserify Error', e.toString(), '\x1b[0m' );
            })
            .pipe( source('bundle.js') );

        if ( !devMode ) {
            stream = stream
                .pipe( buffer() )
        }

        stream.pipe( gulp.dest( path.dist.client ) );

        return stream;
    };

    return bundle();
});

// todo: convert to makefile task to run build steps
gulp.task( 'build', gulp.series('sass', 'browserify'), function build (cb) {
    cb();
});

// todo:  convert to makefile default task
gulp.task( 'default', gulp.series('build'), function defaultTask (cb) {
    cb();
});
