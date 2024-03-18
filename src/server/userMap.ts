import { logger } from './routes.js'
import {UserMapOp} from './logger.js'

// err - An error object if the operation fails.
// returns void - This function does not return anything (mutator function).
type errorCallback = ((err: Error | null) => void) | undefined;
// todo: is Error | null good? or should we use Error | undefined?

/**
 * A callback function type for standard operations.
 * 
 * @param err An error object if the operation fails, otherwise null.
 * @param res A result object if the operation succeeds.
 * @returns void This function does not return anything (mutator function).
 */
type standardCallback = (err: Error | null, result?: any) => void;


interface UserMap {
  [userID: string]: any; // todo: any
  set(userID: string, key: string, value: string, callback?: errorCallback): void;
  delete(userID: string, keys: Array<string>, callback?: errorCallback): void;
  getAll(userID: string, callback: standardCallback): void
}


export const userMap: UserMap = {
  /**
   * Sets a key-value pair for a user. If the user and/or key does not exist, they are created.
   * 
   * @param userID - The ID of the user.
   * @param key - The key to be set or edited for the specified user.
   * @param value - The value to be associated with the specified key. Overrides existing
   *                         value.
   * @param callback - The optional callback to be invoked if the operation fails.
   * @returns This function does not return anything (mutator function).
   */
  set(userID: string, key: string, value: string, callback: errorCallback = undefined): void {
      try {
        if (!this[userID])
          this[userID] = {};

        this[userID][key] = value;
        logger.userMapMod(this, userID, UserMapOp.SET);

        if (callback)
          return callback(null);
      } catch (error) {
        if (callback)
          return callback(error as Error);
      }
  },

  /**
   * Deletes a list of keys and their associated data for a user. If the user or one of 
   * the keys cannot be found, nothing happens.
   * 
   * @param userID - The ID of the user.
   * @param keys - The list of keys to be deleted along with their data.
   * @param callback - The optional callback to be invoked if the operation fails.
   * @returns - This function does not return anything (mutator function).
   */
  delete(userID: string, keys: Array<string>, callback?: errorCallback): void {
      try {
        const userInfo = this[userID];
        
        if (!userInfo) {
          if (callback)
            return callback(null);
          return
        }
        
        for (const key of keys) {
          if (key in userInfo) {
            delete userInfo[key];
            logger.userMapMod(this, userID, UserMapOp.DELETE);
          }
        }

        if (callback)
          return callback(null);
      } catch (error) {
        if (callback)
          return callback(error as Error);
      }
  },

  /**
   * Retrieves all of the data (keys and values) associated with a user. If user is not
   * found, an empty object is returned.
   * 
   * @param userID - The ID of the user.
   * @param callback - The callback to be invoked on failure or success.
   * @returns - This function does not return anything (mutator function)
   */
  getAll(userID: string, callback: standardCallback): void {
      logger.userMapMod(this, userID, UserMapOp.SET);

      try {
          const userInfo = this[userID];

          if (!userInfo) {
            return callback(null, {});
          }

          // Return a shallow copy of the userInfo object
          const userInfoCopy = Object.assign({}, userInfo);
          
          return callback(null, userInfoCopy);
      } catch (error) {
          return callback(error as Error, null);
      }
  }
}