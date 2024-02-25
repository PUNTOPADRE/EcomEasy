// cartController.js
let carts = {}; // Almacenar los carritos de los usuarios
const db = require('../models/db');


function addToCart(userId, productId, quantity) {
    return new Promise((resolve, reject) => {
        // Consulta para añadir un producto al carrito con la cantidad especificada
        const query = 'INSERT INTO carrito (user_id, product_id, cantidad) VALUES (?, ?, ?)';

        db.query(query, [userId, productId, quantity], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results.insertId); // Devuelve el ID del registro insertado
        });
    });
}



function getCart(userId) {
    return new Promise((resolve, reject) => {
        // Suponiendo que 'db' es tu conexión a la base de datos
        const query = `
            SELECT p.nombre, p.precio
            FROM carrito c
            JOIN productos p ON c.product_id = p.id
            WHERE c.user_id = ?
        `;

        db.query(query, [userId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}


function clearCart(userId) {
    return new Promise((resolve, reject) => {
        const query = 'DELETE FROM carrito WHERE user_id = ?';

        db.query(query, [userId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results.affectedRows); // Devuelve la cantidad de filas afectadas
        });
    });
}


function getProductDetails(productId) {
    return new Promise((resolve, reject) => {
        // La consulta para obtener los detalles de un producto específico
        const query = 'SELECT * FROM productos WHERE id = ?';

        db.query(query, [productId], (error, results) => {
            if (error) {
                return reject(error);
            }
            // Asumimos que tu consulta devuelve una fila por producto
            if (results.length > 0) {
                resolve(results[0]); // Devuelve los detalles del primer producto
            } else {
                reject(new Error('Producto no encontrado'));
            }
        });
    });
}

function getCartWithTotals(userId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT c.product_id, p.nombre, SUM(c.cantidad) AS cantidad_total, p.precio, (SUM(c.cantidad) * p.precio) AS precio_total
            FROM carrito c
            INNER JOIN productos p ON c.product_id = p.id
            WHERE c.user_id = ?
            GROUP BY c.product_id
            ORDER BY p.nombre;
        `;

        db.query(query, [userId], (error, results) => {
            if (error) {
                console.error('Error en getCartWithTotals:', error);
                return reject(new Error(`Error al obtener los totales del carrito para el usuario ${userId}: ${error.message}`));
            }
            if (results.length === 0) {
                console.log(`No se encontraron artículos en el carrito para el usuario ${userId}.`);
            }
            resolve(results);
        });
    });
}


function removeFromCart(userId, productId) {
    return new Promise((resolve, reject) => {
        const query = 'DELETE FROM carrito WHERE user_id = ? AND product_id = ?';

        db.query(query, [userId, productId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results.affectedRows); // Devuelve la cantidad de filas afectadas
        });
    });
}

function getCartItemsForOrder(userId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT c.product_id, p.nombre, c.cantidad, p.precio
            FROM carrito c
            JOIN productos p ON c.product_id = p.id
            WHERE c.user_id = ?;
        `;

        db.query(query, [userId], (error, results) => {
            if (error) {
                return reject(error);
            }

            // Formatear los resultados como array de objetos para createOrder
            const cartItems = results.map(item => ({
                productId: item.product_id,
                quantity: item.cantidad,
                price: item.precio
            }));

            resolve(cartItems);
        });
    });
}


module.exports = {
    addToCart,
    getCart,
    clearCart,
    getProductDetails,
    getCartWithTotals,
    removeFromCart,
    getCartItemsForOrder
}