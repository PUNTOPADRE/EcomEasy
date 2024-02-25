const db = require('../models/db'); // Asegúrate de que esta ruta sea correcta

const productController = {
    // Añadir producto
    addProduct: async (name, category, price, photo) => {
        return new Promise((resolve, reject) => {
            // Valida y convierte los datos de entrada si es necesario
            category = parseInt(category, 10);
            price = parseFloat(price.replace(/[^0-9.-]+/g, ""));

            // Valida los datos de entrada después de intentar convertirlos
            if (typeof name !== 'string' || isNaN(category) || isNaN(price) || typeof photo !== 'string') {
                return reject(new Error('Datos de entrada inválidos para añadir producto'));
            }

            const query = 'INSERT INTO productos (nombre, categoria, precio, foto) VALUES (?, ?, ?, ?)';
            db.query(query, [name, category, price, photo], (error, results) => {
                if (error) {
                    console.error('Error al añadir producto:', error);
                    return reject(error);
                }
                resolve(results.insertId);
            });
        });
    },

    // Obtener todos los productos
    getAllProducts: async () => {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM productos';
            db.query(query, (error, results) => {
                if (error) {
                    return reject(error);
                }
                resolve(results);
            });
        });
    },

    // Obtener un producto por ID
    getProductById: async (id) => {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM productos WHERE id = ?';
            db.query(query, [id], (error, results) => {
                if (error) {
                    return reject(error);
                }
                resolve(results[0]);
            });
        });
    },

    // Actualizar un producto
    updateProduct: async (id, name, category, price, photo) => {
        return new Promise((resolve, reject) => {
            // Convierte 'category' y 'price' si es necesario
            category = parseInt(category, 10);
            price = parseFloat(price.replace(/[^0-9.-]+/g, ""));

            const query = 'UPDATE productos SET nombre = ?, categoria = ?, precio = ?, foto = ? WHERE id = ?';
            db.query(query, [name, category, price, photo, id], (error, results) => {
                if (error) {
                    return reject(error);
                }
                resolve(results.affectedRows);
            });
        });
    },

    // Eliminar un producto
    deleteProduct: async (id) => {
        return new Promise((resolve, reject) => {
            const query = 'DELETE FROM productos WHERE id = ?';
            db.query(query, [id], (error, results) => {
                if (error) {
                    return reject(error);
                }
                resolve(results.affectedRows);
            });
        });
    }
};

module.exports = productController;
