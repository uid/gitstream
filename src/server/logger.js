const redis = require('redis');

const CLI_COL = {
    MAG: '\x1b[35m',
    RST: '\x1b[0m',
    GRN: '\x1b[32m',
    BLU: '\x1b[34m',
};

/**
 * Fetch relavent meta information from caller, for logging and debugging purposes.
 * 
 * @returns Filename and line number of the instance of the `log` that was called. If not found,
 * returns NA for both.
 */
function getCallerInfo() {
    try {
      throw new Error();
    } catch (error) {
      const stack = error.stack;
      if (stack) {
        const lines = stack.split('\n');
        const callerLine = lines[3]; // grab caller infor
        const matches = /\((.*?):(\d+:\d+)\)/.exec(callerLine); // Use regex to extract info
        if (matches && matches.length === 3) {
          const [, filePath, lineInfo] = matches;
          const fileName = filePath.split('/').pop(); // Extract the file name from the path
          const lineNum = lineInfo.split(':')[0]; // Extract the line number
  
          return {fileName, lineNum};
        }
      }
    }
    return {fileName: 'NA', lineNum: 'NA'};
  }

module.exports = function( opts ) {
    var dbcon = opts.dbcon

    return {
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

        redisCall: function(client, userID, type) {
            const callerInfo = getCallerInfo();

            const location = `${CLI_COL.GRN}[${callerInfo.fileName}:${callerInfo.lineNum}]` +
            `${CLI_COL.MAG}[${type}]${CLI_COL.RST}`;

            client.hgetall(userID, (err, content) => {
                if (err) {
                    console.error(err);
                    return;
                }

                let contentAll = CLI_COL.BLU;
                Object.keys(content).forEach(field => {
                    contentAll += field + ': ' + content[field] + '\n';
                  });
                contentAll += CLI_COL.RST
                console.log(`\nLocation:\n${location}\nContent:\n${contentAll}`);
            });
        }

    }
}
