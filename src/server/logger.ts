import { Db } from "mongodb";

const CONFIG = {
    LOG_CONSOLE: true,
    LOG_MONGO: true,
    WS_DEBUG_IND: false, // all individual user events (normal and error)
    WS_DEBUG_SUM: true   // summary of user events (aggregated stats and individual errors)
}

export enum WebSocketEvent {
    STATUS = 'Status',
    SENT = 'Sent',
    RECEIVED = 'Received'
}

export enum WebSocketDebug {
    INFO = 'info',
    ERROR = 'error'
}

export enum ConnectionType {
    ADD = 'Add',
    REMOVE = 'Remove',
}

enum ConsoleColor {
    MAG = '\x1b[35m', // magenta
    RST = '\x1b[0m',  // reset
    GRN = '\x1b[32m', // green
    BLU = '\x1b[34m', // blue
};

export enum EventType {
    NEW_USER = 'NEW_USER',
    INIT_CLONE = 'INIT_CLONE',
    QUIT = 'QUIT',
    EM = 'EM',
    GO = 'GO',
    CHANGE_EXERCISE = 'CHANGE_EXERCISE',
    SYNC = 'SYNC',
    ERROR = 'ERROR'
}

export enum ErrorType {
    GIT_HTTP = 'GIT_HTTP',
    CREATE_REPO = 'CREATE_REPO',
    ON_RECEIVE = 'ON_RECEIVE', 
    EX = 'EXERCISE_ERR',
    DB = 'DB_ERR',
    ERR = 'ERR'
  }

export enum UserMapOp {
    SET = 'set',
    DELETE = 'delete',
    GET_ALL = 'getAll'
}

interface LogRecord {
    timestamp: number;
    userId: string;
    event: EventType;
    exercise: string;
    data: any;

    errorType?: ErrorType;
}

/**
 * Format a field and its content with a specified width.
 * Truncates content if it exceeds the specified width.
 * 
 * @param field - The field name.
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


export const logger = {
    /**
     * Method that inserts standardized log records to the database
     * 
     * @param record The log record object to be inserted
     */
    _log: function(record: LogRecord) {
        // todo: insert praxistutor logger here
        
        // mongodb.then((db: Db) => {
        //     db.collection('logs').insertOne(record);
        // }).catch((err: any) => { // todo: any
        //     console.error('[ERROR] GS Logger error:', record, err);
        // });
        console.log('[_log called]')
    },

    /**
     * Logs an event with its associated data.
     * 
     * @param eventType The type of event to log.
     * @param userId The ID of the user associated with the event.
     * @param exerciseName The exercise related to the event.
     * @param data Additional data relevant to the event (optional).
     */
    log: function(eventType: EventType, userId: string, exerciseName?: string, data?: any) {          
        if (CONFIG.LOG_CONSOLE) {
            console.info(eventType, userId, exerciseName, data);
        }

        this._log({
            userId: userId,
            event: eventType,
            exercise: exerciseName || "NA",
            data: data,
            timestamp: Date.now()
        })
    },

    /**
     * Logs an error with its associated data.
     * 
     * @param type The type of error to log.
     * @param userId The ID of the user associated with the error.
     * @param exercise The exercise related to the error.
     * @param data Additional data relevant to the error.
     */
    err: function( type: ErrorType, userId: string, exercise: string, data: any ) {
        if (CONFIG.LOG_CONSOLE) {
            console.error(type, userId, exercise, data);
        }

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
     * @param type - Type of operation
     */
    userMapMod: function(userMap: {[userID: string]: any}, userID: string, type: UserMapOp) {
        if (!(CONFIG.LOG_CONSOLE || CONFIG.LOG_MONGO)) return; // if both false, skip this function

        const callerInfo = getCallerInfo(2);

        const location = `${ConsoleColor.GRN}[${callerInfo.fileName}:${callerInfo.lineNum}]` +
                            `${ConsoleColor.MAG}[${type}]${ConsoleColor.RST}`;

        const userInfo = userMap[userID] ?? {};
        let contentAll: string = ConsoleColor.BLU;

        Object.keys(userInfo).forEach(field => {
            const formattedEntry = formatField(field, userInfo[field]);
            contentAll += formattedEntry + '\n';
        });

        contentAll += ConsoleColor.RST;

        const output = `[User Map][${userID}]\n${location}\n${contentAll}`;
        

        // todo: add conditional for if logging individual, proceed
        if (CONFIG.LOG_CONSOLE) {
            console.log(`\n${output}`);
        }
        if (CONFIG.LOG_MONGO) {
            // todo: praxis stuff here
        }
    },

    /**
     * Log WebSocket events
     * 
     * @param type - of WebSocket
     * @param output - any object
     * @returns - nothing
     */
    ws: function(type: WebSocketEvent, output: any) { // todo: standardize type of output
        if (!CONFIG.WS_DEBUG_IND) return

        const strOutput = JSON.stringify(output);
        strOutput.replace(/\"/g, ""); // remove extra quotation marks

        const trueOutput = `\n[WS][Server][${type}] ${strOutput}\n`;
        
        if (CONFIG.LOG_CONSOLE) {
            console.log(trueOutput);
        }
        if (CONFIG.LOG_MONGO) {
            // log.info(trueOutput);
        }
    },

    ws_debug: function(type: WebSocketDebug, msg: string, output: any) {
        if (CONFIG.WS_DEBUG_SUM) {
            console.log(`[ws ${type} debug]: ${msg}\n`, output)
        }
    },

    /**
     * Log active connections
     * 
     * @param type 
     * @param active
     * @returns - nothing
     */
    connections: function(type: ConnectionType, active: string[]): void {
        if (CONFIG.WS_DEBUG_SUM) {
            console.log(`\n[${type} Connection] Current Active Users:\n${active.join('\n')}\n`);
        }
    },

    /**
     * Logs database errors with additional context information.
     * 
     * This function returns a callback that, when invoked with an error, logs the error
     * along with the user ID, exercise name, and additional data provided. If the error
     * is null, indicating no error occurred, the callback will simply return without
     * performing any logging.
     *
     * @param userId - The ID of the user associated with the database operation
     * @param exercise - The name of the exercise
     * @param data - Additional data to be logged
     * @returns A callback function that takes an optional Error object.
     */
    logDbErr: function(userId: string, exercise: string, data: any): (err: Error | null) => void { // todo: any
        return (err: Error | null) => { // todo: any
            if (!err) return
            
            data.msg = err.message
            
            console.error(err);

            this.err(ErrorType.DB, userId, exercise, data);
        }
    }
}