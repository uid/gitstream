const fs = require("fs");
const path = require('path');

const CONFIG = {
    LOG_CONSOLE: true,
    LOG_FILE: true,
    LOG_DIR: '/opt/gitstream/logs',
    WS_DEBUG_IND: false, // individual user events
    WS_DEBUG_SUM: true// summarized user events (aggregated stats or errors)
}

const WS_TYPE = {
    STATUS: 'Status',
    SENT: 'Sent',
    RECEIVED: 'Received'
}

const CLI_COL = {
    MAG: '\x1b[35m',
    RST: '\x1b[0m',
    GRN: '\x1b[32m',
    BLU: '\x1b[34m',
};

const colorCodeRegex = /\x1b\[\d{1,2}m/g;

let allLogFiles = {};

const current_time = new Date();

const timestamp = {
    date: current_time.toISOString().split('T')[0],
    time: current_time.toLocaleTimeString('en-US', { hour12: false }),
};

const sharedLogDir = path.join(CONFIG.LOG_DIR, `${timestamp.date}_${timestamp.time}`);


// Save all log files from the same session under the same timestamped folder
if (CONFIG.LOG_FILE){
    // todo: more graceful way to handle this edge case?
    if (!fs.existsSync(CONFIG.LOG_DIR)) {
        console.error(`[ERROR] Log directory ${CONFIG.LOG_DIR} does not exist.
        To fix, run \`mkdir ${CONFIG.LOG_DIR}; chmod 777 ${CONFIG.LOG_DIR}\``);

        process.exit(1); // exit
    }

    fs.chmodSync(CONFIG.LOG_DIR, 0o777);
    fs.mkdirSync(sharedLogDir);
    fs.chmodSync(sharedLogDir, 0o777);
}

/**
 * Log content to a specified file.
 *  
 * @param {string} directory - The directory where the file should be placed.
 * @param {string} prefix - The prefix for the log file.
 * @param {string} content - The content to be logged.
 * @returns {void} Nothing.
 */
function logToFile(directory, prefix, content) {
    const filePath = path.join(directory, `${prefix}.log`);

    // If the prefix is not found, create the file and record it.
    if (!(prefix in allLogFiles)) {
        fs.writeFileSync(filePath, "");
        fs.chmodSync(filePath, 0o777);
        allLogFiles[prefix] = true;
    }

    fs.appendFileSync(filePath, content);
}

/**
 * Format a field and its content with a specified width.
 * Truncates content if it exceeds the specified width.
 * 
 * @param field- The field name.
 * @param {string} content - The content associated with the field.
 * @param width - The desired width for the field. Default 20.
 * @returns - The formatted string with proper padding.
 */
function formatField(field, content, width = 20) {
    const fieldString = field + ':';
    const contentString = String(content).substring(0, width);
    const padding = ' '.repeat(width - fieldString.length);
    return fieldString + padding + contentString;
  }

/**
 * Retrieves filename and line number information from some ancestor caller function that was called.
 * 
 * @param depth - The number of callers up the stack to retrieve information from. Default is 1 for parent.
 * @returns {Object} - Filename and line number of the instance of the caller that was called. 
 *                     If not found, returns NA for both properties.
 */
function getCallerInfo(depth = 1) {
    try {
        throw new Error();
    } catch (error) {
        const stack = error.stack;
        if (stack) {
            const lines = stack.split('\n');
            const stackIndex = depth + 2; // Add 2 to account for the throw error and getCallerInfo lines
            const callerLine = lines[stackIndex]; // grab caller info
            const matches = /\((.*?):(\d+:\d+)\)/.exec(callerLine); // Use regex to extract info
            if (matches && matches.length === 3) {
                const [, filePath, lineInfo] = matches;
                const fileName = filePath.split('/').pop(); // Extract the file name
                const lineNum = lineInfo.split(':')[0]; // Extract the line number

                return { fileName, lineNum };
            }
        }
    }
    return { fileName: 'NA', lineNum: 'NA' };
}

module.exports = function( opts ) {
    var dbcon = opts.dbcon

    return {
        CONFIG,
        WS_TYPE,

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

        _log: function( record ) {
            record.timestamp = Date.now()

            dbcon.done( function( db ) {
                db.collection('logs').insertOne( record, function( err ) {
                    if ( err ) { console.error( '[ERROR] Logger error:', record, err ) }
                })
            })
        },

        log: function( eventType, userId, exercise, data ) {
            // if ( !this.EVENT[ eventType ] ) {
            //     return console.error( '[ERROR] Tried logging invalid event: ', eventType )
            // }
            console.info(eventType, userId, exercise, data);
            this._log({
                userId: userId,
                event: eventType,
                exercise: exercise,
                data: data
            })
        },

        err: function( type, userId, exercise, data ) {
            // if ( !this.ERR[ type ] ) {
            //     return console.error( '[ERROR] Tried logging invalid error type: ', type, data )
            // }
            console.error(type, userId, exercise, data);
            this._log({
                event: this.EVENT.ERROR,
                type: type,
                userId: userId,
                exercise: exercise,
                data: data
            })
        },
        
        /**
         * Log the state of a user's data as it exists in memory.
         * 
         * @param {object} userMap - Map object containing all user data
         * @param {string} userID - ID of user
         * @param {string} type - Type of operation: set, expire, delete, getall
         */
        userMapMod: function(userMap, userID, type) {
            if (!(CONFIG.LOG_CONSOLE || CONFIG.LOG_FILE)) return;

            const callerInfo = getCallerInfo(2);

            let location = `${CLI_COL.GRN}[${callerInfo.fileName}:${callerInfo.lineNum}]` +
                             `${CLI_COL.MAG}[${type}]${CLI_COL.RST}`;

            const userInfo = userMap[userID] ?? {};
            let contentAll = CLI_COL.BLU;

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
         * @param {typeof WS_TYPE} type of WebSocket
         * @param {object} output any object
         * @returns nothing
         */
        ws: function(type, output){
            if (CONFIG.WS_DEBUG_IND) {
                const strOutput = JSON.stringify(output);
                strOutput.replace(/\"/g, ""); // remove extra quotation marks

                const trueOutput = `\n[WS][Server][${type}] ${strOutput}\n`;
                
                console.log(trueOutput);
            }
        }
    }
}
