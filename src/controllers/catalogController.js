const db = require('../models/db');

// Función para obtener todas las categorías y sus iconos
const getCategories = async () => {
    return new Promise((resolve, reject) => {
        const query = 'SELECT id, name, icon FROM categories';
        db.query(query, (err, results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results.map(category => ({
                    id: category.id,
                    name: category.name,
                    icon: category.icon
                })));
            }
        });
    });
};

async function updateCategory(categoryId, newName, newIcon) {
    return new Promise((resolve, reject) => {
        const query = 'UPDATE categories SET name = ?, icon = ? WHERE id = ?';
        db.query(query, [newName, newIcon, categoryId], (error, results) => {
            if (error) {
                return reject(error);
            }
            resolve(results.affectedRows);
        });
    });
};

async function deleteCategory(categoryId) {
    return new Promise((resolve, reject) => {
        const query = 'DELETE FROM categories WHERE id = ?';

        db.query(query, [categoryId], (error, results) => {
            if (error) {
                console.error(`Error al eliminar la categoría: ${error}`);
                return reject(error);
            }
            resolve(results.affectedRows);
        });
    });
}



// Función para obtener los productos de una categoría específica
const getProductsByCategory = async (categoryId) => {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM productos WHERE categoria = ?';
        db.query(query, [categoryId], (err, products) => {
            if (err) {
                reject(err);
            } else {
                const queryCategoryName = 'SELECT name FROM categories WHERE id = ?';
                db.query(queryCategoryName, [categoryId], (err, categoryResults) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({
                            products: products,
                            categoryName: categoryResults[0].name
                        });
                    }
                });
            }
        });
    });
};


module.exports = {
    getCategories,
    getProductsByCategory,
    updateCategory,
    deleteCategory
};
