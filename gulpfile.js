var gulp = require('gulp'),
    uglify = require('uglify-to-browserify'),
    browserify = require('browserify'),
    concatCss = require('gulp-concat-css'),
    jscs,
    jshint,
    livereload,
    minifyCss = require('gulp-minify-css'),
    plumber = require('gulp-plumber'),
    prefixer = require('gulp-autoprefixer'),
    rename = require('gulp-rename'),
    rimraf,
    sass = require('gulp-sass'),
    source = require('vinyl-source-stream'),
    stylish,
    uglify = require('gulp-uglify'),
    watchify,

    production = process.env.NODE_ENV === 'production',

    path = {
        src: {
            all: 'src/**/*',
            js: 'src/**/*.js',
            client: {
                main: './src/client/js/main.js',
                scss: 'src/client/**/*.s[ac]ss',
                static: [
                    'src/client/resources/**/*',
                    'src/client/exercises/**/*',
                    'src/client/index.html'
                ]
            },
            server: 'src/server/**/*'
        },
        dist: {
            base: 'dist/',
            all: 'dist/**/*',
            client: 'dist/client/',
            server: 'dist/server/',
            serverMain: 'dist/server/main.js'
        }
    },

    watching;

if ( !production ) {
    jscs = require('gulp-jscs');
    jshint = require('gulp-jshint');
    livereload = require('gulp-livereload');
    rimraf = require('rimraf');
    stylish = require('jshint-stylish');
    watchify = require('watchify');
}

gulp.task( 'build', [ 'sass', 'browserify', 'collectstatic', 'collectserver' ] );
gulp.task( 'default', [ 'checkstyle', 'watch', 'build' ] );

gulp.task( 'clean', function( cb ) {
    rimraf( path.dist.base, cb );
});

gulp.task( 'checkstyle', function() {
    gulp.src( path.src.js )
        .pipe( plumber() )
        .pipe( jscs() )
        .pipe( jshint() )
        .pipe( jshint.reporter( stylish ) );
});

gulp.task( 'sass', function() {
    gulp.src( path.src.client.scss )
        .pipe( plumber() )
        .pipe( sass() )
        .pipe( minifyCss({ cache: true }) )
        .pipe( concatCss('bundle.css') )
        .pipe( prefixer('> 5%') )
        .pipe( gulp.dest( path.dist.client ) );
});

gulp.task( 'browserify', function() {
    var bundler = browserify({
        cache: {}, packageCache: {}, fullPaths: true,
        entries: path.src.client.main,
        debug: !production
    });

    var bundle = function() {
        return bundler
            .bundle()
            .pipe( source('bundle.js') )
            .pipe( gulp.dest( path.dist.client ) );
    };

    if ( watching ) {
        bundler = watchify( bundler );
        bundler.on( 'update', bundle );
    }

    return bundle();
});

gulp.task( 'collectstatic', function() {
    gulp.src( path.src.client.static )
        .pipe( gulp.dest( path.dist.client ) );
});

gulp.task( 'collectserver', function() {
    gulp.src( path.src.server )
        .pipe( gulp.dest( path.dist.server ) );
});

gulp.task( 'watch', function() {
    watching = true;
    gulp.watch( path.src.js, [ 'checkstyle' ] );
    gulp.watch( path.src.client.scss, [ 'sass' ] );
    gulp.watch( path.src.client.static, [ 'collectstatic' ] );
    gulp.watch( path.src.server, [ 'collectserver' ] );
    gulp.watch( path.dist.all ).on( 'change', livereload.changed );
});
