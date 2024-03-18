
// External Libraries
import compression from 'compression';
import { Application } from 'express';
import { Server } from 'http';
import path from 'path';
import EventEmitter from 'events';
import { spawn } from 'child_process';
import { MongoClient, Db } from 'mongodb';
import { rimraf } from 'rimraf';
import _ from 'lodash';
import * as url from 'url';

const mongodb: Promise<Db> = MongoClient.connect('mongodb://localhost/gitstream')
    .then((client: MongoClient) => client.db());

// Internal Files
import angler from 'git-angler';
import exerciseConfs from 'gitstream-exercises';
import { CommitSpec, utils } from './utils.js';
import { createLogger, EventType, ErrorType } from './logger.js';
import { createUser } from './user.js';
import * as routesUtils from './routesUtils.js';
import { setupWebSocketServer } from './ws.js';

// Configure user and logger
export const logger = createLogger(mongodb);
export const user = createUser(mongodb);

// Constant Global Variables

const __dirname = url.fileURLToPath(new URL('.', import.meta.url)); // esm way to get dirname

export const PATH_TO_REPOS = '/srv/repos',
    PATH_TO_EXERCISES = __dirname + '/exercises/'

const REPO_NAME_REGEX = /\/[a-z0-9_-]+\/[a-f0-9]{6,}\/.+.git$/,
    gitHTTPMount = '/repos'; // no trailing slash

export const eventBus = new angler.EventBus();

const githookEndpoint = angler.githookEndpoint({
        pathToRepos: PATH_TO_REPOS,
        eventBus: eventBus,
        gitHTTPMount: gitHTTPMount
    });

const backend = angler.gitHttpBackend({
    pathToRepos: PATH_TO_REPOS,
    eventBus: eventBus,
    authenticator: function( params: { repoPath: any; }, callback: any ) { // todo: any
        verifyAndGetRepoInfo( params.repoPath )
        .then( function() {
            callback({ok: true})
        }).catch(function( err ) {
            const info = routesUtils.extractRepoInfoFromPath( params.repoPath );
            if (info) {
                logger.err( ErrorType.GIT_HTTP, info.userId, info.exerciseName, {
                    msg: err.message
                })
            }
            callback({ ok: false, status: 404 })
        })
    }
})

export const exerciseEvents = new EventEmitter();

// Custom Types and Interfaces

export interface ExerciseData {
    userId: string;
    exerciseName: string;
    mac: string;
    macMsg?: string;
}

export type RepoPath = string | string[];

/**
 * Verifies the MAC provided in a repo's path (ex. /username/beef42-exercise2.git)
 * @param repoPath a path string or an array of path components
 * @return promise
 */
function verifyAndGetRepoInfo(repoPath: RepoPath): Promise<ExerciseData> {
    const repoInfo = routesUtils.extractRepoInfoFromPath(repoPath);

    if (!repoInfo) {
        throw Error('Could not get repo info');
    }

    return user.verifyMac(repoInfo.userId, repoInfo.mac, repoInfo.macMsg as string)
        .then(function() {
            return repoInfo;
        });
}

/**
 * Creates a new exercise repo.
 * @param repoName - the full repo name. e.g. /nhynes/12345/exercise1.git
 * @return a promise resolved with the repo info as returned by verifyAndGetRepoInfo
 */
function createRepo(repoName: string): Promise<ExerciseData> {
    const pathToRepo = path.join( PATH_TO_REPOS, repoName );
    const pathToRepoDir = path.dirname( pathToRepo );

    let repoInfo: ExerciseData,
        pathToExercise: string,
        pathToStarterRepo: string;

    return verifyAndGetRepoInfo(repoName)
    .then(function (info) {
        repoInfo = info;
        pathToExercise = path.join(PATH_TO_EXERCISES, repoInfo.exerciseName);
        pathToStarterRepo = path.join(pathToExercise, 'starting.git');

        return rimraf(pathToRepoDir, {});
    })
    .then(function () {
        let repoUtils = {
            _: _, // todo: looks weird, change later
            resourcesPath: pathToExercise
        };
        let commits: Promise<CommitSpec[] | undefined> = new Promise(function (resolve, reject) {
            const commitsConf = exerciseConfs.repos[repoInfo.exerciseName]().commits;
            
            if (Array.isArray(commitsConf) && commitsConf.length) {
                resolve(commitsConf as CommitSpec[]);
            } else if (typeof commitsConf === 'function') {
                commitsConf.call(repoUtils, resolve);
            } else {
                resolve(undefined);
            }
        })

        return utils.mkdirp(path.dirname(pathToRepo))
            .then(function () {
                return new Promise(function (resolve, reject) {
                    spawn('cp', ['-r', pathToStarterRepo, pathToRepo])
                        .on('close', function (cpRet) {
                            if (cpRet !== 0) {
                                reject(Error('Copying exercise repo failed'));
                            } else {
                                resolve(undefined);
                            }
                        });
                });
            })
            .then(function () {
                return commits.then(function (commits) {
                    const addCommit = function (spec: CommitSpec) {
                        return utils.addCommit.bind(null, pathToRepo, pathToExercise, spec); // todo: not use bind?
                    };

                    if (commits) {
                        return commits.reduce(function (promise, commit) {
                            return promise.then(function () {
                                return addCommit(commit)();
                            });
                        }, Promise.resolve());
                    } else {
                        return utils.git(pathToRepo, 'commit', ['-m', 'Initial commit']);
                    }
                });
            })
            .then(function () {
                return repoInfo;
            });
    });
}
    
// transparently initialize exercise repos right before user clones it
eventBus.setHandler( '*', '404', function( repoName: string, _: any, data: any, clonable: any ) { // todo: any
    if ( !REPO_NAME_REGEX.test( repoName ) ) { return clonable( false ) }

    const repoInfo = routesUtils.extractRepoInfoFromPath( repoName ) as ExerciseData; // assert good
    logger.log( EventType.INIT_CLONE, repoInfo.userId, repoInfo.exerciseName )

    createRepo(repoName)
        .then(function() {
            clonable(true)
        }).catch(function(err) {
            clonable(false)
            logger.err(ErrorType.CREATE_REPO, repoInfo.userId, repoInfo.exerciseName, {
                msg: err.message
            })
        })
})

// hard resets and checks out the updated HEAD after a push to a non-bare remote repo
// this can't be done inside of the post-receive hook, for some reason
// NOTE: when Git >= 2.3.0 is in APT, look into `receive.denyCurrentBranch updateInstead`
eventBus.setHandler( '*', 'receive', function( repo: string, action: any, updates: any[], done: () => void ) { // todo: any
    const repoPath = path.resolve( PATH_TO_REPOS, '.' + repo );
    const git = utils.git.bind( utils, repoPath );
    const isPushingShadowBranch = updates.reduce( function( isbr, update ) {
            return isbr || update.name === 'refs/heads/shadowbranch'
        }, false )

    const chain = git( 'reset', '--hard' )
        .then( function() {
            return git( 'checkout', ':/')
        })

    if ( isPushingShadowBranch ) {
        chain.then( function() {
            return git( 'update-ref', 'refs/gitstream/shadowbranch refs/heads/shadowbranch' )
        })
        .then( function() {
            return git( 'update-ref', '-d refs/heads/shadowbranch' )
        })
    }

    chain.catch( function( err ) {
        const repoInfo = routesUtils.extractRepoInfoFromPath( repo ) as ExerciseData; // assert good
        logger.err( ErrorType.ON_RECEIVE, repoInfo.userId, repoInfo.exerciseName, {
            msg: err.message
        })
    })
    .done( function() {
        done()
    })
})

export async function configureApp(app: Application, server: Server) {
    // Set up WebSocket server
    setupWebSocketServer(server);

    // set up routes
    app.use( compression() );
    app.use( '/repos', backend );
    app.use( '/hooks', githookEndpoint );

    // invoked from the "go" script in client repo
    app.use( '/go', function( req, res ) {
        if ( !req.headers['x-gitstream-repo'] ) {
            res.writeHead(400)
            return res.end()
        }

        const remoteUrl = req.headers['x-gitstream-repo'] as string;
        const repo = remoteUrl.substring( remoteUrl.indexOf( gitHTTPMount ) + gitHTTPMount.length);

        createRepo( repo )
        .then( function( repoInfo ) {
            // only 1 instance of publish
            // note: this messaging system will kept for now
            const handlePublishError = logger.logDbErr( repoInfo.userId, repoInfo.exerciseName, {
                desc: 'userMap go emit'
            })

            try {
                exerciseEvents.emit(repoInfo.userId + ':go', repoInfo.exerciseName); 
            } catch (err) {
                if (err instanceof Error){
                    handlePublishError(err);
                }
            }

            res.writeHead( 200 )
            res.end()
        }).catch( function( err ) {
            res.writeHead( 403 )
            res.end()

            logger.err( ErrorType.CREATE_REPO, 'null', 'null', {
                desc: 'New repo on go',
                repo: repo,
                remoteUrl: remoteUrl,
                msg: err.message
            })
        })
    });
}
