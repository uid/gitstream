import express from 'express';
import { configureApp } from './routes.js'

const app = express();
const PORT = 4242; // for WebSocket connection
const server = app.listen(PORT)

configureApp(app, server);

