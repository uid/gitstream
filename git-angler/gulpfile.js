var gulp = require('gulp'),
    jscs = require('gulp-jscs'),
    jshint = require('gulp-jshint'),
    plumber = require('gulp-plumber'),
    nodeunit = require('gulp-nodeunit'),
    stylish = require('jshint-stylish'),
    production = process.env.NODE_ENV === 'production';


var path = {
    js: [ 'test/**/*.js', 'lib/**/*.js' ],
    tests: 'test/**/*.js',
    lib: 'lib/'
}

gulp.task( 'default', [ 'checkstyle', 'test', 'watch' ] );

// replace w/ mocha
gulp.task( 'test', function() {
    gulp.src( path.tests )
        .pipe( plumber())
        .pipe( nodeunit() );
});

// replace w/ eslint in future, eliminate entirely for now
gulp.task( 'checkstyle', function() {
    gulp.src( path.js )
        .pipe( plumber())
        .pipe( jscs() )
        .pipe( jshint() )
        .pipe( jshint.reporter( stylish ) );
});

// not important
gulp.task( 'watch', function() {
    gulp.watch( [ path.js ], [ 'checkstyle', 'test' ]);
});
