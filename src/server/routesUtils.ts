// helper functions used by route handlers

import crypto from 'crypto';
import path from 'path';
import { ExerciseData, RepoPath } from './routes.js'

/**
 * Generates a random 5 character ID string prefixed with 'user'
 */
export function createRandomId(): string {
  return 'user' + crypto.pseudoRandomBytes(3).toString('hex').substring(0, 5)
}


/** Does the inverse of @see extractRepoInfoFromPath. macMsg is not required */
export function createRepoShortPath( info: ExerciseData ) {
  return path.join( '/', info.userId, info.mac, info.exerciseName + '.git' )
}

/**
 * Extracts data from the components of a repo's path
 * @param repoPath - a path string or an array of path components
 * @return data - if repo path is invalid, returns null
 */
export function extractRepoInfoFromPath(repoPath: RepoPath):ExerciseData | null {
  // slice(1) to remove the '' from splitting '/something'
  let splitRepoPath = repoPath instanceof Array ? repoPath : repoPath.split('/').slice(1),
      userId,
      repoMac,
      exerciseName,
      macMsg

  if ( splitRepoPath.length < 3) {
      return null
  }

  // e.g. /nhynes/12345/exercisename.git
  userId = splitRepoPath[0]
  repoMac = splitRepoPath[1]
  exerciseName = splitRepoPath[2].replace( /\.git$/, '' ),
  macMsg = userId + exerciseName

  return {
      userId: userId,
      mac: repoMac,
      exerciseName: exerciseName,
      macMsg: macMsg
  }
}
