// db.js

const mysql = require('mysql');
const dbConfig = require('../config/dbConfig');


// Función para manejar la conexión
function handleDisconnect() {
    // Crear una nueva conexión
    const connection = mysql.createConnection(dbConfig);

    // Conectar a la base de datos
    connection.connect(err => {
        if (err) {
            console.error('Error al conectar a la base de datos:', err);
            // Intentar reconectar después de 2 segundos si hay un error
            setTimeout(handleDisconnect, 2000);
        } else {
            console.log('Conectado a la base de datos');
        }
    });

    // Manejar el error de desconexión y reconectar automáticamente
    connection.on('error', err => {
        console.error('Error en la base de datos:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            handleDisconnect();
        } else {
            throw err;
        }
    });

    return connection;
}

// Iniciar la conexión
const db = handleDisconnect();

module.exports = db;
