// server.js

const express = require('express');
const app = express();

// Conexión a la base de datos
const db = require('./src/models/db');

// Iniciar el bot de Telegram
const bot = require('./src/bot');

// Configuraciones adicionales de Express, rutas, etc.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
