console.error('using main.ts');

import { app, server } from './app.js';
import { configureApp } from './routes.js'

configureApp(app, server);

