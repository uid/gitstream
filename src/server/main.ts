import express from 'express';
import { configureAppFirst } from './app.js';
import { configureApp } from './routes.js'

const app = express();
const PORT = 4242; // for WebSocket connection
const server = app.listen(PORT)

configureAppFirst(app).catch(err => console.error(err));
configureApp(app, server);

