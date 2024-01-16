import fs from "fs";
import { Db } from "mongodb";
import path from 'path';

console.error('using logger.ts');


const CONFIG = {
    LOG_CONSOLE: true,
    LOG_FILE: false,
    LOG_DIR: '/opt/gitstream/logs',
    WS_DEBUG_IND: false, // individual user events
    WS_DEBUG_SUM: true // summarized user events (aggregated stats or errors)
}

const WS_TYPE = {
    STATUS: 'Status',
    SENT: 'Sent',
    RECEIVED: 'Received'
}

// todo: make main.js use the enum
enum WS_Type {
    STATUS = 'Status',
    SENT = 'Sent',
    RECEIVED = 'Received'
}

enum CLI_COL {
    MAG = '\x1b[35m',
    RST = '\x1b[0m',
    GRN = '\x1b[32m',
    BLU = '\x1b[34m',
};

enum EventType {
    NEW_USER = 'NEW_USER',
    INIT_CLONE = 'INIT_CLONE',
    QUIT = 'QUIT',
    EM = 'EM',
    GO = 'GO',
    CHANGE_EXERCISE = 'CHANGE_EXERCISE',
    SYNC = 'SYNC',
    ERROR = 'ERROR'
}

enum ErrorType {
    GIT_HTTP = 'GIT_HTTP',
    CREATE_REPO = 'CREATE_REPO',
    ON_RECEIVE = 'ON_RECEIVE', 
    EX = 'EXERCISE_ERR',
    DB = 'DB_ERR',
    ERR = 'ERR'
  }

// todo: figure out the 'any' types later
interface LogRecord {
    timestamp: number;
    userId: any;
    event: EventType;
    exercise: any;
    data: any;
    errorType?: ErrorType;
  }

const colorCodeRegex = /\x1b\[\d{1,2}m/g;

/**
 * Map of log file names to boolean indicating 
 * if that log file has already been created.
 */
let allLogFiles: {[name: string]: boolean} = {};

let sharedLogDir: string;

// Save all log files from the same session under the same timestamped folder
if (CONFIG.LOG_FILE){
    const now = new Date();
    const timestamp = {
        date: now.toISOString().split('T')[0],
        time: now.toLocaleTimeString('en-US', { hour12: false }),
    };

    // todo: more graceful way to handle this edge case?
    if (!fs.existsSync(CONFIG.LOG_DIR)) {
        console.error(`[ERROR] Log directory ${CONFIG.LOG_DIR} does not exist.
        To fix, run \`mkdir ${CONFIG.LOG_DIR}; chmod 777 ${CONFIG.LOG_DIR}\``);

        process.exit(1); // exit
    }

    sharedLogDir = path.join(CONFIG.LOG_DIR, `${timestamp.date}_${timestamp.time}`);
    fs.mkdirSync(sharedLogDir);
    fs.chmodSync(sharedLogDir, 0o777);
}

/**
 * Log content to a specified file.
 *  
 * @param {string} directory - The directory where the file should be placed.
 * @param {string} name - The name for the log file (aka before `.log`)
 * @param {string} content - The content to be logged.
 * @returns {void} Nothing.
 */
function logToFile(directory: string, name: string, content: string | Uint8Array): void {
    const filePath = path.join(directory, `${name}.log`);

    // If the name is not found, create the file and record it.
    if (!(name in allLogFiles)) {
        fs.writeFileSync(filePath, "");
        fs.chmodSync(filePath, 0o777);
        allLogFiles[name] = true;
    }

    fs.appendFileSync(filePath, content);
}

/**
 * Format a field and its content with a specified width.
 * Truncates content if it exceeds the specified width.
 * 
 * @param field- The field name.
 * @param content - The content associated with the field.
 * @param width - The desired width for the field. Default 20.
 * @returns - The formatted string with proper padding.
 */
function formatField(field: string, content: string, width: number = 20): string {
    const fieldString = field + ':';
    const contentString = String(content).substring(0, width);
    const padding = ' '.repeat(width - fieldString.length);
    return fieldString + padding + contentString;
  }

/**
 * Retrieves filename and line number information from some ancestor caller function that was called.
 * 
 * @param depth - The number of callers up the stack to retrieve information from. Default is 1 for parent.
 * @returns Filename and line number of the instance of the caller that was called. 
 *                     If not found, returns NA for both properties.
 */
function getCallerInfo(depth: number = 1): {fileName: string, lineNum: string} {
    try {
        throw new Error();
    } catch (error) {
        if (error instanceof Error && error.stack) {
            const stack = error.stack;
            const lines = stack.split('\n');
            const stackIndex = depth + 2; // Add 2 to account for the throw error and getCallerInfo lines
            const callerLine = lines[stackIndex]; // grab caller info
            const matches = /\((.*?):(\d+:\d+)\)/.exec(callerLine); // Use regex to extract info
            if (matches && matches.length === 3) {
                const [, filePath, lineInfo] = matches;
                const fileName = filePath.split('/').pop() || 'error'; // Extract the file name
                const lineNum = lineInfo.split(':')[0]; // Extract the line number

                return { fileName , lineNum };
            }
        }
    }
    return { fileName: 'NA', lineNum: 'NA' };
}


module.exports = function (opts: {dbcon: Q.Promise<Db>}) {

    const dbcon = opts.dbcon;

    return {
        CONFIG,
        WS_TYPE,

        // todo: replace with enum defined above
        EVENT: {
            NEW_USER: 'NEW_USER',
            INIT_CLONE: 'INIT_CLONE',
            QUIT: 'QUIT',
            EM: 'EM',
            GO: 'GO',
            CHANGE_EXERCISE: 'CHANGE_EXERCISE',
            SYNC: 'SYNC',
            ERROR: 'ERROR'
        },

        ERR: {
            GIT_HTTP: 'GIT_HTTP',
            CREATE_REPO: 'LOG_ERR',
            ON_RECEIVE: 'ON_RECEIVE',
            EX: 'EXERCISE_ERR',
            DB: 'DB_ERR',
            ERR: 'ERR'
        },

        _log: function( record: LogRecord) {
            dbcon.done( function( db ) {
                db.collection('logs').insertOne( record, function( err ) { // todo: fix. soon to be deprecated
                    if ( err ) { console.error( '[ERROR] Logger error:', record, err ) }
                })
            })
        },

        log: function( eventType: EventType, userId: any, exercise: any, data: any) {
            // if ( !this.EVENT[ eventType ] ) {
            //     return console.error( '[ERROR] Tried logging invalid event: ', eventType )
            // }
            
            console.info(eventType, userId, exercise, data);
            this._log({
                userId: userId,
                event: eventType,
                exercise: exercise,
                data: data,
                timestamp: Date.now()
            })
        },

        err: function( type: ErrorType, userId: any, exercise: any, data: any ) {
            // if ( !this.ERR[ type ] ) {
            //     return console.error( '[ERROR] Tried logging invalid error type: ', type, data )
            // }
            console.error(type, userId, exercise, data);

            this._log({
                event: EventType.ERROR,
                errorType: type,
                userId: userId,
                exercise: exercise,
                data: data,
                timestamp: Date.now()
            })
        },
        
        /**
         * Log the state of a user's data as it exists in memory.
         * 
         * @param userMap - Map object containing all user data
         * @param userID - ID of user
         * @param type - Type of operation: set, expire, delete, getall
         */
        userMapMod: function(userMap: {[userID: string]: any}, userID: string, type: string) {
            if (!(CONFIG.LOG_CONSOLE || CONFIG.LOG_FILE)) return;

            const callerInfo = getCallerInfo(2);

            let location = `${CLI_COL.GRN}[${callerInfo.fileName}:${callerInfo.lineNum}]` +
                             `${CLI_COL.MAG}[${type}]${CLI_COL.RST}`;

            const userInfo = userMap[userID] ?? {};
            let contentAll: string = CLI_COL.BLU;

            Object.keys(userInfo).forEach(field => {
                const formattedEntry = formatField(field, userInfo[field]);
                contentAll += formattedEntry + '\n';
            });

            contentAll += CLI_COL.RST;

            const output = `[User Map][${userID}]\n${location}\n${contentAll}`;
            
            if (CONFIG.LOG_CONSOLE)
                console.log(`\n${output}`);
            
            if (CONFIG.LOG_FILE)
                logToFile(sharedLogDir, 'userMap', `${output.replace(colorCodeRegex, '')}\n`);
        },

        /**
         * Log WebSocket events
         * 
         * @param type of WebSocket
         * @param output any object
         * @returns nothing
         */
        ws: function(type: WS_Type, output: any){ // todo: standardize type of output
            if (CONFIG.WS_DEBUG_IND) {
                const strOutput = JSON.stringify(output);
                strOutput.replace(/\"/g, ""); // remove extra quotation marks

                const trueOutput = `\n[WS][Server][${type}] ${strOutput}\n`;
                
                console.log(trueOutput);
            }
        }
    }
}
