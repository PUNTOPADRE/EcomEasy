const db = require('../models/db');

async function handleStartCommand(telegramId) {
    let userExists = await checkUserExists(telegramId);
    if (!userExists) {
        await createUser(telegramId);
    }

    let isOwner = await checkIfOwnerExists();
    if (!isOwner && !userExists) {
        // Logic to guide user to become owner
        return 'Bienvenido, por favor sigue las instrucciones para configurar el bot.';
    } else {
        // Welcome message
        return 'Bienvenido de nuevo al bot.';
    }
}

async function checkUserExists(telegramId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM users WHERE telegram_id = ?';
        db.query(query, [telegramId], (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results.length > 0);
        });
    });
}

async function createUser(telegramId) {
    return new Promise((resolve, reject) => {
        const query = 'INSERT INTO users (telegram_id, is_admin, is_owner) VALUES (?, 0, 0)';
        db.query(query, [telegramId], (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

async function checkIfOwnerExists() {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM users WHERE is_owner = 1';
        db.query(query, (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results.length > 0);
        });
    });
}

async function setAsOwner(telegramId) {
    return new Promise((resolve, reject) => {
        const query = 'UPDATE users SET is_owner = 1 WHERE telegram_id = ?';
        db.query(query, [telegramId], (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

async function getUser(telegramId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM users WHERE telegram_id = ?';
        db.query(query, [telegramId], (err, results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results.length ? results[0] : null);
            }
        });
    });
}

async function setLanguage(telegramId, language) {
    return new Promise((resolve, reject) => {
        const query = 'UPDATE users SET language = ? WHERE telegram_id = ?';
        db.query(query, [language, telegramId], (err, results) => {
            if (err) {
                reject(err);
            } else if (results.affectedRows === 0) {
                reject(new Error('No se actualizó el idioma porque el usuario no existe.'));
            } else {
                resolve();
            }
        });
    });
}

async function saveAdminPasswords(telegramId, passwords) {
    return Promise.all(passwords.map((password) => {
        return new Promise((resolve, reject) => {
            const query = 'INSERT INTO admin_passwords (password, used, created_by_telegram_id) VALUES (?, 0, ?)';
            db.query(query, [password, telegramId], (err, results) => {
                if (err) {
                    console.error(`Error al guardar la contraseña: ${err.message}`);
                    return reject(err);
                }
                resolve();
            });
        });
    }));
}

async function isOwner(telegramId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT is_owner FROM users WHERE telegram_id = ?';
        db.query(query, [telegramId], (err, results) => {
            if (err) {
                return reject(err);
            }
            // Asumiendo que la columna 'is_owner' es un booleano
            resolve(results.length > 0 && results[0].is_owner);
        });
    });
}

function setAwaitingPasswordState(telegramId, isAwaiting) {
    if (!userStates[telegramId]) {
        userStates[telegramId] = {};
    }
    userStates[telegramId].awaitingPassword = isAwaiting;
}

async function saveCategory(telegramId, categoryName, categoryIcon) {
    return new Promise((resolve, reject) => {
        const query = 'INSERT INTO categories (name, icon, created_by) VALUES (?, ?, ?)';
        db.query(query, [categoryName, categoryIcon, telegramId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results.insertId); // Devuelve el ID de la categoría insertada
        });
    });
}

async function checkAdminOrOwner(telegramId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT is_admin, is_owner FROM users WHERE telegram_id = ?';
        db.query(query, [telegramId], (err, results) => {
            if (err) {
                return reject(err);
            }
            // Si el usuario es admin o owner, results[0] debería tener is_admin = 1 o is_owner = 1
            const isAdminOrOwner = results.length > 0 && (results[0].is_admin === 1 || results[0].is_owner === 1);
            resolve(isAdminOrOwner);
        });
    });
}

function generateSecurePassword() {
    const length = 15;
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

async function addNewAdminPassword(password, createdByTelegramId) {
    return new Promise((resolve, reject) => {
        const creationTime = new Date();
        const used = 0; // Inicialmente, la contraseña no ha sido usada

        const query = 'INSERT INTO admin_passwords (password, used, created_by_telegram_id, creation_time) VALUES (?, ?, ?, ?)';
        
        db.query(query, [password, used, createdByTelegramId, creationTime], (error, results) => {
            if (error) {
                console.error(`Error al añadir nueva contraseña de admin: ${error}`);
                return reject(error);
            }
            resolve(results.insertId);
        });
    });
}

const verifyAdminPassword = async (providedPassword, telegramId) => {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM admin_passwords WHERE password = ? AND used = 0 AND TIMESTAMPDIFF(MINUTE, creation_time, NOW()) <= 10';
        
        db.query(query, [providedPassword], (error, results) => {
            if (error) {
                console.error(`Error al verificar la contraseña de administrador: ${error.message}`);
                return reject(error);
            }
            
            if (results.length > 0) {
                // La contraseña es correcta y no ha sido utilizada.
                // Marcar la contraseña como utilizada.
                const updateQuery = 'UPDATE admin_passwords SET used = 1, used_by_telegram_id = ? WHERE id = ?';
                
                db.query(updateQuery, [telegramId, results[0].id], (updateError) => {
                    if (updateError) {
                        console.error(`Error al marcar la contraseña de administrador como utilizada: ${updateError.message}`);
                        return reject(updateError);
                    }
                    
                    // Todo ha salido bien, la contraseña es válida y ahora está marcada como utilizada.
                    resolve(true);
                });
            } else {
                // No se encontró una contraseña válida o ya ha sido utilizada.
                resolve(false);
            }
        });
    });
};
const makeUserAdmin = async (telegramId) => {
    return new Promise((resolve, reject) => {
        const query = 'UPDATE users SET is_admin = 1 WHERE telegram_id = ?';

        db.query(query, [telegramId], (error, results) => {
            if (error) {
                console.error(`Error al hacer usuario admin: ${error.message}`);
                return reject(error);
            }
            if (results.affectedRows === 0) {
                // No se encontró el usuario o no se necesitó actualización.
                resolve(false);
            } else {
                // El usuario fue actualizado exitosamente.
                resolve(true);
            }
        });
    });
};

function getUserInfo(telegramId) {
    return new Promise((resolve, reject) => {
        // Obtener información del usuario de la tabla 'users' usando telegram_id
        const userQuery = 'SELECT * FROM users WHERE telegram_id = ?';

        db.query(userQuery, [telegramId], (userError, userResults) => {
            if (userError) {
                return reject(userError);
            }
            if (userResults.length === 0) {
                return reject(new Error('Usuario no encontrado'));
            }

            const user = userResults[0];

            // Obtener el nombre de usuario de Instagram de la tabla 'verificaciones'
        const instagramQuery = 'SELECT instagram_username, foto FROM verificaciones WHERE user_id = ?';

        db.query(instagramQuery, [telegramId], (instagramError, instagramResults) => {
                if (instagramError) {
                    return reject(instagramError);
                }

                const userInfo = {
                    ...user,
                    instagramUsername: instagramResults.length > 0 ? instagramResults[0].instagram_username : null,
                    instagramPhoto: instagramResults.length > 0 ? instagramResults[0].foto : null
                };

                resolve(userInfo);
            });
        });
    });
}


module.exports = {
    handleStartCommand,
    checkUserExists,
    createUser,
    checkIfOwnerExists,
    setAsOwner,
    setLanguage,
    saveAdminPasswords,
    isOwner,
    setAwaitingPasswordState,
    saveCategory,
    checkAdminOrOwner,
    getUser,
    generateSecurePassword,
    addNewAdminPassword,
    verifyAdminPassword,
    makeUserAdmin,
    getUserInfo

    // ... other exports
};