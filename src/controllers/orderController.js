// orderController.js
const db = require('../models/db');

function createOrder(userId, address, country, paymentMethod, cartItems) {
    return new Promise(async (resolve, reject) => {
        // Iniciar transacción
        db.beginTransaction(error => {
            if (error) return reject(error);

            const insertOrderQuery = `
                INSERT INTO pedidos (user_id, direccion, pais, forma_pago, estado)
                VALUES (?, ?, ?, ?, 'pendiente');
            `;

            // Insertar pedido
            db.query(insertOrderQuery, [userId, address, country, paymentMethod], (error, orderResults) => {
                if (error) {
                    return db.rollback(() => reject(error));
                }

                const orderId = orderResults.insertId;

                // Insertar detalles del pedido
                const insertDetailsQueries = cartItems.map(item => {
                    const insertDetailQuery = `
                        INSERT INTO order_contents (order_id, product_id, quantity, price)
                        VALUES (?, ?, ?, ?);
                    `;
                    return db.query(insertDetailQuery, [orderId, item.productId, item.quantity, item.price]);
                });

                Promise.all(insertDetailsQueries)
                    .then(() => {
                        db.commit(err => {
                            if (err) {
                                return db.rollback(() => reject(err));
                            }
                            resolve(orderId);
                        });
                    })
                    .catch(error => {
                        db.rollback(() => reject(error));
                    });
            });
        });
    });
}

function getOrderById(orderId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM pedidos WHERE id = ?';

        db.query(query, [orderId], (error, results) => {
            if (error) {
                return reject(error);
            }
            if (results.length > 0) {
                resolve(results[0]);
            } else {
                reject(new Error('Pedido no encontrado'));
            }
        });
    });
}

function updateOrderStatus(orderId, status) {
    return new Promise((resolve, reject) => {
        const query = 'UPDATE pedidos SET estado = ? WHERE id = ?';

        db.query(query, [status, orderId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results.affectedRows); // Devuelve el número de filas afectadas
        });
    });
}

function getAllOrdersByUserId(userId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM pedidos WHERE user_id = ?';

        db.query(query, [userId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

// Función para verificar un usuario
function verifyUser(userId, instagramUsername, photoId) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT INTO verificaciones (user_id, instagram_username, foto)
            VALUES (?, ?, ?);
        `;

        db.query(query, [userId, instagramUsername, photoId], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results.insertId);
            }
        });
    });
}

// Función para guardar el nombre de usuario de Instagram y solicitar la foto para verificación
function saveInstagramUsername(userId, instagramUsername) {
    return new Promise((resolve, reject) => {
        const query = `
            UPDATE verificaciones SET instagram_username = ?
            WHERE user_id = ? AND is_verified = 0;
        `;

        db.query(query, [instagramUsername, userId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

// Función para guardar la foto de verificación y actualizar la fecha de verificación
function saveVerificationPhoto(userId, photoPath) {
    return new Promise((resolve, reject) => {
        const query = `
            UPDATE verificaciones SET foto = ?, verification_date = CURRENT_TIMESTAMP
            WHERE user_id = ? AND is_verified = 0;
        `;

        db.query(query, [photoPath, userId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

// Función para marcar un usuario como verificado
function setUserVerified(userId) {
    return new Promise((resolve, reject) => {
        const query = 'UPDATE users SET is_verified = 1 WHERE telegram_id = ?';

        db.query(query, [userId], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results.affectedRows);
            }
        });
    });
}

function getUser(userId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM users WHERE telegram_id = ?';

        db.query(query, [userId], (error, results) => {
            if (error) {
                return reject(error);
            }
            if (results.length > 0) {
                resolve(results[0]); // Devuelve la información del usuario
            } else {
                reject(new Error('Usuario no encontrado'));
            }
        });
    });
}

function getOrderContents(orderId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT p.nombre, oc.quantity, oc.price
            FROM order_contents oc
            JOIN productos p ON oc.product_id = p.id
            WHERE oc.order_id = ?;
        `;

        db.query(query, [orderId], (error, results) => {
            if (error) {
                return reject(error);
            }

            // Formatear los resultados para mostrar en el mensaje
            let contents = results.map(row => `• ${row.nombre} x ${row.quantity} - ${row.price}€`).join('\n');
            resolve(contents);
        });
    });
}


function getPendingOrders() {
    return new Promise((resolve, reject) => {
        const query = `
        SELECT ped.id, ped.fecha, ped.direccion, usr.telegram_id, ver.instagram_username, GROUP_CONCAT(prod.nombre SEPARATOR ', ') as productos
        FROM pedidos ped
        JOIN users usr ON ped.user_id = usr.telegram_id
        LEFT JOIN verificaciones ver ON usr.telegram_id = ver.user_id
        LEFT JOIN order_contents oc ON ped.id = oc.order_id
        LEFT JOIN productos prod ON oc.product_id = prod.id
        WHERE ped.estado = 'pendiente'
        GROUP BY ped.id;
        `;

        db.query(query, (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

function acceptOrder(orderId) {
    return updateOrderStatus(orderId, 'aceptado');
}

// Función para rechazar un pedido
function rejectOrder(orderId) {
    return updateOrderStatus(orderId, 'rechazado');
}

function getAcceptedOrders() {
    return new Promise((resolve, reject) => {
        const query = `
        SELECT ped.id, ped.fecha, ped.direccion, usr.telegram_id, ver.instagram_username, GROUP_CONCAT(prod.nombre SEPARATOR ', ') as productos
        FROM pedidos ped
        JOIN users usr ON ped.user_id = usr.telegram_id
        LEFT JOIN verificaciones ver ON usr.telegram_id = ver.user_id
        LEFT JOIN order_contents oc ON ped.id = oc.order_id
        LEFT JOIN productos prod ON oc.product_id = prod.id
        WHERE ped.estado = 'aceptado'
        GROUP BY ped.id;
        `;

        db.query(query, (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}

function getCanceledOrders() {
    return new Promise((resolve, reject) => {
        const query = `
        SELECT ped.id, ped.fecha, ped.direccion, usr.telegram_id, ver.instagram_username, GROUP_CONCAT(prod.nombre SEPARATOR ', ') as productos
        FROM pedidos ped
        JOIN users usr ON ped.user_id = usr.telegram_id
        LEFT JOIN verificaciones ver ON usr.telegram_id = ver.user_id
        LEFT JOIN order_contents oc ON ped.id = oc.order_id
        LEFT JOIN productos prod ON oc.product_id = prod.id
        WHERE ped.estado = 'rechazado'
        GROUP BY ped.id;
        `;

        db.query(query, (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results);
        });
    });
}



module.exports = {
    createOrder,
    getOrderById,
    updateOrderStatus,
    getAllOrdersByUserId,
    verifyUser,
    saveInstagramUsername,
    saveVerificationPhoto,
    setUserVerified,
    getUser,
    getOrderContents,
    getPendingOrders,
    acceptOrder,
    rejectOrder,
    getAcceptedOrders,
    getCanceledOrders
    
};
