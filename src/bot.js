require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const userController = require('./controllers/userController');
const catalogController = require('./controllers/catalogController');
const productController = require('./controllers/productController');
const cartController = require('./controllers/cartController');
const orderController = require('./controllers/orderController')

const token = process.env.TELEGRAM_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });

let awaitingPassword = false;
let adminPasswords = [];
let userStates = {};
let awaitingCategoryName = false;
let awaitingCategoryIcon = false;
let tempCategory = {};
let chatStates = {};
let pendingOrdersMessageIds = [];


function validatePassword(password) {
    const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{10,}$/;
    return regex.test(password);
}

async function showCart(chatId) {
    const cartItems = await cartController.getCartWithTotals(chatId);
    let messageText = 'Artículos en tu carrito:\n';
    let total = 0;

    if (cartItems.length === 0) {
        messageText += "Tu carrito está vacío.";
    } else {
        for (const item of cartItems) {
            messageText += `${item.cantidad_total}x ${item.nombre} - Unidad: ${item.precio.toFixed(2)}€ - Total: ${item.precio_total.toFixed(2)}€\n`;
            total += item.precio_total;
        }
        messageText += `\nTOTAL: ${total.toFixed(2)}€`;
    }

    const keyboard = cartItems.length > 0 ?
        [
            [{ text: 'Vaciar carrito', callback_data: 'empty_cart' }, { text: 'Editar carrito', callback_data: 'edit_cart' }],
            [{ text: 'Volver', callback_data: 'back_to_language' }]
        ] :
        [[{ text: 'Volver', callback_data: 'back_to_language' }]];

    // Asegúrate de que este ID sea el correcto y de que se ha guardado en el estado del usuario cuando se mostró el carrito originalmente
    const cartMessageId = userStates[chatId] && userStates[chatId].cartMessageId;

    await bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: cartMessageId,
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
}

// Función para obtener el emoji de la bandera basado en el código de idioma
function getFlagEmoji(languageCode) {
    const flags = {
        'GB': '🇬🇧',
        'DE': '🇩🇪',
        'FR': '🇫🇷',
        'ES': '🇪🇸',
        // Agrega más banderas según sea necesario
    };
    return flags[languageCode] || '🏳️'; // Bandera por defecto si no se encuentra el código
}

function getAdminMenuButtons(isOwner) {
    const adminMenuButtons = [
        [{ text: '📁 Categorías', callback_data: 'manage_categories' }],
        [{ text: '📦 Stock', callback_data: 'admin_stock' }],
        [{ text: '📑 Pedidos', callback_data: 'manage_orders' }], // Nuevo botón para gestionar pedidos
        // ... otros botones del menú de administrador
    ];
    
    if (isOwner) {
        adminMenuButtons.push([{ text: '👤 Administradores', callback_data: 'manage_admins' }]);
    }
    
    adminMenuButtons.push([{ text: '⬅️ Volver', callback_data: 'back_to_language' }]);

    return adminMenuButtons;
}


bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    // Aquí guardas que el usuario está en el paso de ingresar la contraseña
    userStates[chatId] = { step: 'awaitingAdminPassword' };
    await bot.sendMessage(chatId, "Por favor, introduce la contraseña de administrador:");
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        // Intenta obtener el usuario de la base de datos
        let user = await userController.getUser(chatId);
        
        // Si el usuario no existe, intenta crearlo
        if (!user) {
            await userController.createUser(chatId);
            // Vuelve a obtener la información del usuario después de crearlo
            user = await userController.getUser(chatId);
        }

        let userLanguage = user ? user.language : null;
        const isAdminOrOwner = await userController.checkAdminOrOwner(chatId);

        let inlineKeyboard = [
            [
                { text: "🇬🇧", callback_data: 'language_GB' },
                { text: "🇩🇪", callback_data: 'language_DE' },
                { text: "🇫🇷", callback_data: 'language_FR' },
                { text: "🇪🇸", callback_data: 'language_ES' }
            ]
        ];

        if (userLanguage) {
            inlineKeyboard.push([{ text: "📚 Catálogo", callback_data: 'show_catalog' }]);
            inlineKeyboard.push([{ text: "🛒 Carrito", callback_data: 'view_cart' }]);
            inlineKeyboard.push([{ text: "📦 Pedidos", callback_data: 'view_orders' }]);
        }

        if (isAdminOrOwner) {
            inlineKeyboard.push([{ text: "🛠️ Administrador", callback_data: 'admin_panel' }]);
        }

        const languageOptions = {
            reply_markup: { inline_keyboard: inlineKeyboard }
        };

        if (userLanguage) {
            const flagEmoji = getFlagEmoji(userLanguage);
            await bot.sendMessage(chatId, `Idioma seleccionado: ${flagEmoji}`, languageOptions);
        } else {
            await bot.sendMessage(chatId, "Por favor, selecciona tu idioma:", languageOptions);
        }
    } catch (error) {
        console.error(`Error en /start: ${error}`);
        await bot.sendMessage(chatId, "Hubo un error al iniciar el bot. Por favor, intenta nuevamente.");
    }
});


bot.on('callback_query', async (callbackQuery) => {
    console.log("Callback Query recibida: ", callbackQuery.data);
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;
    const messageId = message.message_id;

    // Guardar el id de la callbackQuery para usarlo en la respuesta
    if (userStates[chatId]) {
        userStates[chatId].callbackQueryId = callbackQuery.id;
    } else {
        userStates[chatId] = { callbackQueryId: callbackQuery.id };
    }
    


    if (data.startsWith('language_')) {
        const language = data.split('_')[1];
        try {
            await userController.setLanguage(chatId, language);
            const flagEmoji = getFlagEmoji(language); // Utiliza la función para obtener el emoji de la bandera

            // Verifica si ya hay un owner
            const isOwnerExists = await userController.checkIfOwnerExists();
            if (!isOwnerExists) {
                // Si no hay owner, establece al usuario actual como owner
                await userController.setAsOwner(chatId);
            }

            // Actualiza el mensaje para reflejar el idioma seleccionado
            const newMessageText = `Idioma seleccionado: ${flagEmoji}`;
                // Solo editar si el texto del mensaje es diferente
                if (message.text !== newMessageText) {
                    await bot.editMessageText(newMessageText, {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: message.reply_markup // Mantén los botones actuales
                    });
                }

            // Si se ha convertido en owner, envía las instrucciones para configurar el bot
            if (!isOwnerExists) {
                const welcomeMsg = "Has sido establecido como el owner del bot. Por favor, sigue las instrucciones para configurar tu bot.";
                const options = {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Configurar bot', callback_data: 'configure_bot' }
                        ]]
                    }
                };
                await bot.sendMessage(chatId, welcomeMsg, options);
            }

        } catch (error) {
            console.error(`Error al manejar la selección de idioma: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al configurar tu idioma. Por favor, intenta nuevamente.");
        }
    } else if (data === 'configure_bot') {
        try {
            const isOwner = await userController.isOwner(chatId);
            if (isOwner) {
                await bot.sendMessage(chatId, "Por favor, introduce la primera contraseña de administrador. Debe tener al menos 10 caracteres, incluyendo letras, números y símbolos.");
                userStates[chatId] = { awaitingPassword: true, adminPasswords: [] };
            } else {
                await bot.sendMessage(chatId, "No tienes permisos para configurar el bot.");
            }
        } catch (error) {
            console.error(`Error durante la configuración: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error durante la configuración. Por favor, intenta nuevamente.");
        }
    } else if (data.startsWith('category_')) {
        const categoryId = data.split('_')[1];
        userStates[chatId] = userStates[chatId] || {};
        userStates[chatId].productMessages = userStates[chatId].productMessages || []; // Asegurarse de que productMessages sea un arreglo
        userStates[chatId].currentCategoryId = categoryId;
    
        try {
            const { products, categoryName } = await catalogController.getProductsByCategory(categoryId);
    
            // Editar el mensaje existente para mostrar el nombre de la categoría y el botón de volver
            let replyMarkup = {
                inline_keyboard: [
                    [{ text: 'Volver al Catálogo', callback_data: 'show_catalog' }]
                ]
            };
            const sentCategoryMessage = await bot.editMessageText(`Productos de la categoría: ${categoryName}`, {
                chat_id: chatId,
                message_id: messageId, // Asegúrate de que messageId es el ID del mensaje a editar
                reply_markup: replyMarkup
            });
            userStates[chatId].categoryMessageId = sentCategoryMessage.message_id; // Guardar el message_id del mensaje de categoría
    
            // Eliminar mensajes antiguos de productos antes de enviar los nuevos
            for (const oldMessageId of userStates[chatId].productMessages) {
                await bot.deleteMessage(chatId, oldMessageId);
            }
            userStates[chatId].productMessages = []; // Limpiar el array después de la eliminación
    
            // Enviar fotos de los productos con botones individuales
            for (const product of products) {
                let messageText = `📦 Producto: ${product.nombre}\n💰 Precio: ${product.precio}€`;
                let productReplyMarkup = {
                    inline_keyboard: [[{ text: 'Añadir al Carrito', callback_data: `add_to_cart_${product.id}` }]]
                };
                if (product.foto) {
                    const sentProductMessage = await bot.sendPhoto(chatId, product.foto, { caption: messageText, reply_markup: productReplyMarkup });
                    userStates[chatId].productMessages.push(sentProductMessage.message_id);
                }
            }
    
        } catch (error) {
            console.error(`Error al mostrar productos de la categoría: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al mostrar los productos de la categoría.");
        }
    }
        
    else  if (data === 'show_catalog') {
        try {
            // Elimina los mensajes de los productos si existen
            if (userStates[chatId] && userStates[chatId].productMessages) {
                for (const messageId of userStates[chatId].productMessages) {
                    await bot.deleteMessage(chatId, messageId).catch(error => console.error(`No se pudo eliminar el mensaje: ${error}`));
                }
                userStates[chatId].productMessages = []; // Limpia el array después de eliminar los mensajes
            }
    
            // Obtiene las categorías para volver a mostrar el catálogo
            const categories = await catalogController.getCategories();
            const categoryButtons = categories.map(category => {
                // Cada botón lleva al usuario a la lista de productos de esa categoría
                return [{ text: `${category.icon} ${category.name.toUpperCase()}`, callback_data: `category_${category.id}` }];
            });
    
            // Añade un botón de volver
            categoryButtons.push([{ text: 'Volver', callback_data: 'back_to_language' }]);
    
            // Edita el mensaje actual para mostrar el catálogo
            await bot.editMessageText('CATÁLOGO', {
                chat_id: chatId,
                message_id: messageId, // Este debe ser el ID del mensaje del catálogo que quieres editar
                reply_markup: { inline_keyboard: categoryButtons }
            });
        } catch (error) {
            console.error(`Error al mostrar el catálogo: ${error}`);
            // Si hay un error al editar (por ejemplo, si el mensaje no se encuentra), envía un mensaje de error al chat
            await bot.sendMessage(chatId, "Hubo un error al mostrar el catálogo. Por favor, intenta nuevamente.");
        }
    }
    else if (data === 'back_to_language') {
        // Lógica para volver a la selección de idioma
        const user = await userController.getUser(chatId);
        const flagEmoji = getFlagEmoji(user.language);
        const isAdminOrOwner = await userController.checkAdminOrOwner(chatId);
        let inlineKeyboard = [
            [{ text: "🇬🇧", callback_data: 'language_GB' },
             { text: "🇩🇪", callback_data: 'language_DE' },
             { text: "🇫🇷", callback_data: 'language_FR' },
             { text: "🇪🇸", callback_data: 'language_ES' }]
        ];
        if (user) {
            inlineKeyboard.push([{ text: "📚 Catálogo", callback_data: 'show_catalog' }]);
            inlineKeyboard.push([{ text: "🛒 Carrito", callback_data: 'view_cart' }]);
            inlineKeyboard.push([{ text: "📦 Pedidos", callback_data: 'view_orders' }]);
        }

        if (isAdminOrOwner) {
            inlineKeyboard.push([{ text: "🛠️ Administrador", callback_data: 'admin_panel' }]);
        }

        await bot.editMessageText(`Idioma seleccionado: ${flagEmoji}`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    } else if (data === 'admin_panel') {
        try {
            const isOwner = await userController.isOwner(chatId); // Verifica si el usuario es el propietario
            const adminMenuButtons = [
                [{ text: '📁 Categorías', callback_data: 'manage_categories' }],
                [{ text: '📦 Stock', callback_data: 'admin_stock' }],
                [{ text: '📑 Pedidos', callback_data: 'manage_orders' }], // Nuevo botón para gestionar pedidos
                // ... otros botones del menú de administrador
            ];
            
            if (isOwner) {
                adminMenuButtons.push([{ text: '👤 Administradores', callback_data: 'manage_admins' }]);
            }
            
            adminMenuButtons.push([{ text: '⬅️ Volver', callback_data: 'back_to_language' }]);
            await bot.editMessageText('Menú de Administrador', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: adminMenuButtons }
            });
        } catch (error) {
            console.error(`Error en 'admin_panel': ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al mostrar el menú de administrador.");
        }
    }
    else if (data === 'manage_admins') {
        const adminManagementButtons = [
            [{ text: 'Añadir Administrador', callback_data: 'add_admin' }],
            // ... otros botones de gestión de administradores
            [{ text: 'Volver', callback_data: 'admin_panel' }],
        ];

        await bot.editMessageText('Gestión de Administradores', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: adminManagementButtons }
        });
    }
    else if (data === 'manage_categories') {
        try {
            const categoryManagementButtons = [
                [{ text: '➕ Añadir Categoría', callback_data: 'add_category' }],
                [{ text: '✏️ Editar Categoría', callback_data: 'edit_category' }],
                [{ text: '🗑️ Eliminar Categoría', callback_data: 'delete_category' }],
                [{ text: '⬅️ Volver', callback_data: 'admin_panel' }],
            ];
    
            await bot.editMessageText('Gestión de Categorías', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: categoryManagementButtons }
            });
        } catch (error) {
            console.error(`Error al mostrar las opciones de categorías: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al mostrar las opciones de categorías. Por favor, intenta nuevamente.");
        }
    } else if (callbackQuery.data === 'add_category') {
        userStates[callbackQuery.message.chat.id] = {
            step: 'awaitingCategoryName',
            categoryMessageId: callbackQuery.message.message_id // Guardamos el ID del mensaje original aquí
        };

        // Editar el mensaje existente con una solicitud para el nombre de la nueva categoría
        await bot.editMessageText("Por favor, introduce el nombre de la nueva categoría:", {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Cancelar', callback_data: 'manage_categories' }]
                ]
            }
        });
    } else if (callbackQuery.data === 'edit_category') {
        try {
            const categories = await catalogController.getCategories();
    
            const categoryButtons = categories.map(category => {
                return [{ text: `${category.icon} ${category.name}`, callback_data: `select_edit_${category.id}` }];
            });
    
            // Añadir botón de cancelar
            categoryButtons.push([{ text: 'Cancelar', callback_data: 'manage_categories' }]);
    
            // Editar el mensaje existente con los botones de categoría
            await bot.editMessageText("Selecciona la categoría que deseas editar:", {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: categoryButtons }
            });
        } catch (error) {
            console.error(`Error al mostrar categorías para editar: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al mostrar las categorías para editar.");
        }
    }
    else if (callbackQuery.data.startsWith('select_edit_')) {
        const categoryId = callbackQuery.data.split('_')[2];
        userStates[callbackQuery.message.chat.id] = {
            step: 'awaitingNewCategoryName',
            categoryId: categoryId
        };
        await bot.sendMessage(callbackQuery.message.chat.id, "Por favor, introduce el nuevo nombre de la categoría:");
    } else if (callbackQuery.data === 'delete_category') {
        try {
            const categories = await catalogController.getCategories();
    
            const categoryButtons = categories.map(category => {
                return [{ text: `${category.icon} ${category.name}`, callback_data: `confirm_delete_category_${category.id}` }];
            });
    
            // Añadir botón de cancelar
            categoryButtons.push([{ text: 'Cancelar', callback_data: 'manage_categories' }]);
    
            // Editar el mensaje existente con los botones de categoría
            await bot.editMessageText("Selecciona la categoría que deseas eliminar:", {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: categoryButtons }
            });
        } catch (error) {
            console.error(`Error al mostrar categorías para eliminar: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al mostrar las categorías para eliminar.");
        }
    }
    else if (callbackQuery.data.startsWith('confirm_delete_category_')) {
        const categoryId = callbackQuery.data.split('_')[3];
        await bot.sendMessage(callbackQuery.message.chat.id, "¿Estás seguro de que quieres eliminar esta categoría? Responde 'Sí' para confirmar o 'No' para cancelar.", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Sí', callback_data: `delete_category_${categoryId}` }],
                    [{ text: 'No', callback_data: 'cancel_delete_category' }]
                ]
            }
        });
    } else if (callbackQuery.data.startsWith('delete_category_')) {
        const categoryId = callbackQuery.data.split('_')[2];
        try {
            await catalogController.deleteCategory(categoryId);
            await bot.sendMessage(callbackQuery.message.chat.id, "Categoría eliminada con éxito.");
    
            // Mostrar nuevamente el menú de gestión de categorías
            const categoryManagementButtons = [
                [{ text: '➕ Añadir Categoría', callback_data: 'add_category' }],
                [{ text: '✏️ Editar Categoría', callback_data: 'edit_category' }],
                [{ text: '🗑️ Eliminar Categoría', callback_data: 'delete_category' }],
                [{ text: '⬅️ Volver', callback_data: 'admin_panel' }],
            ];
    
            await bot.sendMessage(callbackQuery.message.chat.id, 'Gestión de Categorías', {
                reply_markup: { inline_keyboard: categoryManagementButtons }
            });
    
        } catch (error) {
            console.error(`Error al eliminar categoría: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al eliminar la categoría.");
        }
    } else if (callbackQuery.data === 'cancel_delete_category') {
        // Mostrar nuevamente el menú de gestión de categorías
        const categoryManagementButtons = [
            [{ text: '➕ Añadir Categoría', callback_data: 'add_category' }],
            [{ text: '✏️ Editar Categoría', callback_data: 'edit_category' }],
            [{ text: '🗑️ Eliminar Categoría', callback_data: 'delete_category' }],
            [{ text: '⬅️ Volver', callback_data: 'admin_panel' }],
        ];
    
        await bot.sendMessage(callbackQuery.message.chat.id, 'Gestión de Categorías', {
            reply_markup: { inline_keyboard: categoryManagementButtons }
        });
    }
    
    else if (data === 'admin_stock') {
        try {
            const stockButtons = [
                [{ text: '➕ Añadir Producto', callback_data: 'add_product' }],
                [{ text: '✏️ Editar Producto', callback_data: 'edit_product' }],
                [{ text: '🗑️ Eliminar Producto', callback_data: 'delete_product' }],
                [{ text: '⬅️ Volver', callback_data: 'admin_panel' }],
            ];
    
            await bot.editMessageText('Gestión de Stock', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: stockButtons }
            });
        } catch (error) {
            console.error(`Error al mostrar la gestión de stock: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al mostrar la gestión de stock. Por favor, intenta nuevamente.");
        }
    }
    else if (callbackQuery.data === 'add_product') {
        try {
            const categories = await catalogController.getCategories();
            const categoryButtons = categories.map(category => {
                return [{ text: `${category.icon} ${category.name.toUpperCase()}`, callback_data: `select_category_${category.id}` }];
            });
    
            // Agregar botón de cancelar
            categoryButtons.push([{ text: 'Cancelar', callback_data: 'admin_stock' }]);
    
            // Editar el mensaje existente con la lista de categorías y el botón de cancelar
            await bot.editMessageText("Selecciona la categoría del producto:", {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: categoryButtons }
            });
    
            // Establecer el estado del usuario para la selección de la categoría
            userStates[callbackQuery.message.chat.id] = { step: 'awaitingCategorySelection' };
        } catch (error) {
            console.error(`Error al mostrar categorías: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al mostrar las categorías.");
        }
    }
    else if (callbackQuery.data.startsWith('select_category_')) {
        const categoryId = callbackQuery.data.split('_')[2];
        userStates[callbackQuery.message.chat.id] = {
            step: 'awaitingProductName',
            selectedCategory: categoryId
        };
        await bot.sendMessage(callbackQuery.message.chat.id, "Por favor, introduce el nombre del producto:");
    } else if (callbackQuery.data === 'edit_product') {
        try {
            const products = await productController.getAllProducts();
            const categories = await catalogController.getCategories();
    
            const categoryIcons = categories.reduce((icons, category) => {
                icons[category.id] = category.icon;
                return icons;
            }, {});
    
            const productButtons = products.map(product => {
                const icon = categoryIcons[product.categoria] || '❓';
                return [{ text: `${icon} ${product.nombre}`, callback_data: `edit_product_${product.id}` }];
            });
    
            // Añadir botón de cancelar al final de los botones de productos
            productButtons.push([{ text: 'Cancelar', callback_data: 'admin_stock' }]);
    
            // Editar el mensaje existente con la lista de productos y botón de cancelar
            await bot.editMessageText("Selecciona un producto para editarlo:", {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: productButtons }
            });
    
        } catch (error) {
            console.error(`Error al mostrar productos para editar: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al mostrar los productos para editar.");
        }
    } else if (callbackQuery.data.startsWith('edit_product_')) {
        const productId = callbackQuery.data.split('_')[2];
        const productToEdit = await productController.getProductById(productId);
    
        userStates[callbackQuery.message.chat.id] = {
            step: 'awaitingProductNameEdit',
            editingProductId: productId,
            selectedCategory: productToEdit.categoria,
        };
    
        await bot.sendMessage(callbackQuery.message.chat.id, "Por favor, introduce el nuevo nombre del producto:");
    } else if (callbackQuery.data === 'delete_product') {
        try {
            const products = await productController.getAllProducts();
            const categories = await catalogController.getCategories();
    
            // Aquí reutilizamos categoryIcons creado anteriormente
            const categoryIcons = categories.reduce((icons, category) => {
                icons[category.id] = category.icon;
                return icons;
            }, {});
    
            const productButtons = products.map(product => {
                const icon = categoryIcons[product.categoria] || '❓';
                return [{ text: `${icon} ${product.nombre}`, callback_data: `confirm_delete_${product.id}` }];
            });
    
            // Agregar botón de cancelar
            productButtons.push([{ text: 'Cancelar', callback_data: 'admin_stock' }]);
    
            // Editar el mensaje existente con la lista de productos y el botón de cancelar
            await bot.editMessageText("Selecciona un producto para eliminarlo:", {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: productButtons }
            });
        } catch (error) {
            console.error(`Error al mostrar productos para eliminar: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al mostrar los productos para eliminar.");
        }
    }

    else if (callbackQuery.data.startsWith('confirm_delete_')) {
        const productId = callbackQuery.data.split('_')[2];
        await bot.sendMessage(callbackQuery.message.chat.id, `¿Estás seguro de que quieres eliminar el producto? Responde "Sí" para confirmar o "No" para cancelar.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Sí', callback_data: `stock_delete_${productId}` }],
                    [{ text: 'No', callback_data: 'cancel_delete' }]
                ]
            }
        });
    }

    else if (callbackQuery.data.startsWith('stock_delete_')) {
        const productId = callbackQuery.data.split('_')[1];
        try {
            // Intenta eliminar el producto y notifica al usuario
            await productController.deleteProduct(productId);
            await bot.sendMessage(callbackQuery.message.chat.id, "Producto eliminado con éxito.");
    
            // Después de la notificación, muestra los botones de gestión de stock
            const stockButtons = [
                [{ text: '➕ Añadir Producto', callback_data: 'add_product' }],
                [{ text: '✏️ Editar Producto', callback_data: 'edit_product' }],
                [{ text: '🗑️ Eliminar Producto', callback_data: 'stock_delete_product' }],
                [{ text: '⬅️ Volver', callback_data: 'admin_panel' }],
            ];
    
            await bot.sendMessage(callbackQuery.message.chat.id, 'Gestión de Stock', {
                reply_markup: { inline_keyboard: stockButtons }
            });
    
        } catch (error) {
            console.error(`Error al eliminar producto: ${error}`);
            await bot.sendMessage(callbackQuery.message.chat.id, "Hubo un error al eliminar el producto.");
        }
    } else if (callbackQuery.data === 'cancel_delete') {
        // La misma lógica de mostrar el menú de gestión de stock cuando el usuario cancela la eliminación
        const stockButtons = [
            [{ text: '➕ Añadir Producto', callback_data: 'add_product' }],
            [{ text: '✏️ Editar Producto', callback_data: 'edit_product' }],
            [{ text: '🗑️ Eliminar Producto', callback_data: 'stock_delete_product' }],
            [{ text: '⬅️ Volver', callback_data: 'admin_panel' }],
        ];
    
        await bot.sendMessage(callbackQuery.message.chat.id, 'Gestión de Stock', {
            reply_markup: { inline_keyboard: stockButtons }
        });
    }

    else if (callbackQuery.data === 'add_admin') {
        try {
            const newPassword = userController.generateSecurePassword();
            const creationTime = new Date();
    
            // Inserta la nueva contraseña en la base de datos
            await userController.addNewAdminPassword(newPassword, creationTime, chatId);
    
            // Edita el mensaje existente con la confirmación de la creación de la contraseña
            const confirmationText = 'Se ha generado una nueva contraseña de administrador con éxito. ' +
                         'Para otorgar privilegios de administrador a un usuario, simplemente comparte esta contraseña. ' +
                         'El usuario deberá utilizar el comando /admin en la conversación con el bot e ingresar la contraseña proporcionada. ' +
                         'Este proceso actualizará su cuenta a administrador.\n' +
                         'Por favor, ten en cuenta que la validez de esta contraseña es de 10 minutos. Transcurrido este tiempo, ' +
                         'la contraseña dejará de ser funcional y será necesario generar una nueva.';
    
            await bot.editMessageText(confirmationText, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: [[{ text: 'Volver', callback_data: 'back_to_admin_management' }]] }
            });
    
            // Enviar la contraseña en un mensaje nuevo y guardar el ID del mensaje
            const passwordMessage = await bot.sendMessage(chatId, newPassword);
            userStates[chatId] = { ...userStates[chatId], passwordMessageId: passwordMessage.message_id };
    
        } catch (error) {
            console.error(`Error al añadir nueva contraseña de administrador: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al crear la nueva contraseña de administrador.");
        }
    } else if (callbackQuery.data === 'back_to_admin_management') {
        // Borrar el mensaje de la contraseña
        try {
            await bot.deleteMessage(chatId, userStates[chatId].passwordMessageId);
        } catch (e) {
            console.error('Error al borrar el mensaje de la contraseña:', e);
        }
    
        // Volver al menú de gestión de administradores
        const adminManagementButtons = [
            [{ text: '➕ Añadir Administrador', callback_data: 'add_admin' }],
            [{ text: '⬅️ Volver', callback_data: 'admin_panel' }]
        ];
    
        // Edita el mensaje existente para volver al menú de gestión de administradores
        await bot.editMessageText('Gestión de Administradores', {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            reply_markup: { inline_keyboard: adminManagementButtons }
        });
    } else if (data === 'manage_orders') {
        // Eliminar mensajes de pedidos pendientes
        for (const messageId of pendingOrdersMessageIds) {
            await bot.deleteMessage(chatId, messageId).catch(error => console.log(`Error deleting message: ${error.toString()}`));
        }
        pendingOrdersMessageIds = [];
    
        // Botones para la gestión de pedidos
        const orderManagementButtons = [
            [{ text: '⏳ Pendientes', callback_data: 'orders_pending' }],
            [{ text: '✅ Aceptados', callback_data: 'orders_accepted' }],
            [{ text: '❌ Cancelados', callback_data: 'orders_canceled' }],
            [{ text: '⬅️ Volver', callback_data: 'admin_panel' }]
        ];
    
        // Edita el mensaje existente para mostrar el menú de gestión de pedidos
        await bot.editMessageText('Gestión de Pedidos', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: orderManagementButtons }
        });
    }
    // Aquí manejas los pedidos pendientes
    else if (data === 'orders_pending') {
        const pendingOrders = await orderController.getPendingOrders();
        await bot.editMessageText("📜 PEDIDOS PENDIENTES", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Volver", callback_data: 'manage_orders' }]
                ]
            }
        });
    
        // Verifica si hay pedidos pendientes
        if (pendingOrders.length === 0) {
            await bot.sendMessage(chatId, "No hay pedidos pendientes.");
            return;
        }
    
        for (const order of pendingOrders) {
            const userInfo = await userController.getUserInfo(order.telegram_id);
            const orderContents = await orderController.getOrderContents(order.id);
    
            const fechaPedido = new Date(order.fecha);
            const fechaFormateada = fechaPedido.toLocaleDateString('es-ES', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });
    
            // Comprueba si hay una foto para enviarla junto con el mensaje.
            if (userInfo.instagramPhoto) {
                sentMessage = await bot.sendPhoto(chatId, userInfo.instagramPhoto, {
                    caption: `Pedido ID: ${order.id}\nInstagram: ${userInfo.instagramUsername}\nFecha: ${fechaFormateada}\n${orderContents}\nDirección: ${order.direccion}`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Aceptar", callback_data: `accept_order_${order.id}` }],
                            [{ text: "❌ Rechazar", callback_data: `reject_order_${order.id}` }],
                            // El botón "Volver" se muestra en el mensaje principal, así que puede que no sea necesario aquí
                        ]
                    }
                });
            } else {
                // Si no hay foto, solo envía el mensaje de texto.
                sentMessage = await bot.sendMessage(chatId, `Pedido ID: ${order.id}\nInstagram: ${userInfo.instagramUsername}\nFecha: ${fechaFormateada}\n${orderContents}\nDirección: ${order.direccion}`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Aceptar", callback_data: `accept_order_${order.id}` }],
                            [{ text: "❌ Rechazar", callback_data: `reject_order_${order.id}` }],
                            // El botón "Volver" se muestra en el mensaje principal, así que puede que no sea necesario aquí
                        ]
                    }
                });
            }
            // Almacena el message_id del mensaje enviado
            pendingOrdersMessageIds.push(sentMessage.message_id);
        }
    }
    if (data === 'orders_accepted') {
        const acceptedOrders = await orderController.getAcceptedOrders();
        await bot.editMessageText("📜 PEDIDOS ACEPTADOS", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Volver", callback_data: 'manage_orders' }]
                ]
            }
        });
    
        // Verifica si hay pedidos aceptados
        if (acceptedOrders.length === 0) {
            await bot.sendMessage(chatId, "No hay pedidos aceptados.");
            return;
        }
    
        for (const order of acceptedOrders) {
            const userInfo = await userController.getUserInfo(order.telegram_id);
            const orderContents = await orderController.getOrderContents(order.id);
    
            const fechaPedido = new Date(order.fecha);
            const fechaFormateada = fechaPedido.toLocaleDateString('es-ES', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });
    
            let orderMessage = `Pedido ID: ${order.id}\nFecha: ${fechaFormateada}\nProductos:\n${orderContents}\nDirección: ${order.direccion}\n`;
    
            // Agregar botones para 'Cancelar' y 'Finalizar'
            let inlineKeyboard = [
                [{ text: "❌ Cancelar", callback_data: `cancel_order_${order.id}` }],
                [{ text: "✅ Finalizar", callback_data: `finalize_order_${order.id}` }]
            ];
    
            // Enviar o editar el mensaje con la información del pedido
            await bot.sendMessage(chatId, orderMessage, {
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
        }
    }
    
    else if (data === 'orders_canceled') {
        const canceledOrders = await orderController.getCanceledOrders();
        await bot.editMessageText("📜 PEDIDOS CANCELADOS", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Volver", callback_data: 'manage_orders' }]
                ]
            }
        });
    
        if (canceledOrders.length === 0) {
            await bot.sendMessage(chatId, "No hay pedidos cancelados.");
            return;
        }
    
        for (const order of canceledOrders) {
            const userInfo = await userController.getUserInfo(order.telegram_id);
            const orderContents = await orderController.getOrderContents(order.id);
    
            const fechaPedido = new Date(order.fecha);
            const fechaFormateada = fechaPedido.toLocaleDateString('es-ES', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });
    
            let orderMessage = `Pedido ID: ${order.id}\nFecha: ${fechaFormateada}\nProductos:\n${orderContents}\nDirección: ${order.direccion}\n`;
    
            let inlineKeyboard = [
                [{ text: "✅ Aceptar", callback_data: `accept_order_${order.id}` }],
                [{ text: "❌ Eliminar", callback_data: `delete_order_${order.id}` }]
            ];
    
            await bot.sendMessage(chatId, orderMessage, {
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
        }
    }
    else if (data.startsWith('accept_order_')) {
        const orderId = data.split('_')[2];
        try {
            await orderController.acceptOrder(orderId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Pedido aceptado." });
            // Aquí podrías eliminar o actualizar el mensaje del pedido pendiente
        } catch (error) {
            console.error('Error al aceptar el pedido:', error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Hubo un error al aceptar el pedido." });
        }
    } else if (data.startsWith('reject_order_')) {
        const orderId = data.split('_')[2];
        try {
            await orderController.rejectOrder(orderId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Pedido rechazado." });
            // Aquí podrías eliminar o actualizar el mensaje del pedido pendiente
        } catch (error) {
            console.error('Error al rechazar el pedido:', error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Hubo un error al rechazar el pedido." });
        }
    }

    else if (data === 'view_cart') {
        try {
            const cartItems = await cartController.getCartWithTotals(chatId);
            let messageText = 'Artículos en tu carrito:\n';
            let total = 0;
    
            if (cartItems.length === 0) {
                messageText += "Tu carrito está vacío.";
            } else {
                for (const item of cartItems) {
                    messageText += `${item.cantidad_total}x ${item.nombre} - Unidad: ${item.precio.toFixed(2)}€ - Total: ${item.precio_total.toFixed(2)}€\n`;
                    total += item.precio_total;
                }
                messageText += `\nTOTAL: ${total.toFixed(2)}€`;
            }
    
            const keyboard = cartItems.length > 0 ?
                [
                    [{ text: '🗑️ Vaciar carrito', callback_data: 'empty_cart' }, { text: '✏️ Editar carrito', callback_data: 'edit_cart' }],
                    [{ text: '✔️ Tramitar pedido', callback_data: 'process_order' }],
                    [{ text: '⬅️ Volver', callback_data: 'back_to_language' }]
                ] :
                [[{ text: '⬅️ Volver', callback_data: 'back_to_language' }]];
    
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        } catch (error) {
            console.error(`Error al mostrar el carrito: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al mostrar el carrito. Por favor, intenta nuevamente.");
        }
    }
    
    else if (data === 'empty_cart') {
        try {
            // Vaciar el carrito del usuario
            await cartController.clearCart(chatId);
    
            // Mensaje indicando que el carrito está vacío
            let messageText = 'Tu carrito está vacío.\n\nSelecciona \'Volver\' para regresar al menú principal.';
    
            // Editar el mensaje actual para reflejar que el carrito está vacío
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '⬅️ Volver', callback_data: 'back_to_language' }]]
                }
            });
    
        } catch (error) {
            console.error(`Error al vaciar el carrito: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al intentar vaciar el carrito.");
        }
    }

    else if (data === 'edit_cart') {
        try {
            const cartItems = await cartController.getCartWithTotals(chatId);
            let messageText = 'Selecciona el artículo que deseas eliminar:\n';
    
            const keyboard = cartItems.map(item => {
                return [{ text: `${item.nombre} - ${item.cantidad_total} en carrito`, callback_data: `delete_item_cart_${item.product_id}` }];
            });
    
            keyboard.push([{ text: '⬅️ Volver', callback_data: 'view_cart' }]); // Agrega un botón para volver al carrito
    
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        } catch (error) {
            console.error(`Error al editar el carrito: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al editar el carrito.");
        }
    }

    else if (data.startsWith('delete_item_cart_')) {
        const parts = data.split('_');
        const productId = parts[3]; // Asegúrate de que el índice es correcto según tu 'callback_data'
        
        try {
            await cartController.removeFromCart(chatId, productId);
            // Notifica al usuario con un mensaje emergente que el artículo fue eliminado
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `El artículo ha sido eliminado del carrito.`,
                show_alert: true
            });
    
            // Después de eliminar el artículo, reutiliza la lógica de 'view_cart'
            const cartItems = await cartController.getCartWithTotals(chatId);
            let messageText = 'Artículos en tu carrito:\n';
            let total = 0;
        
            if (cartItems.length === 0) {
                messageText += "Tu carrito está vacío.";
            } else {
                for (const item of cartItems) {
                    messageText += `${item.cantidad_total}x ${item.nombre} - Unidad: ${item.precio.toFixed(2)}€ - Total: ${item.precio_total.toFixed(2)}€\n`;
                    total += item.precio_total;
                }
                messageText += `\nTOTAL: ${total.toFixed(2)}€`;
            }
        
            const keyboard = cartItems.length > 0 ?
                [
                    [{ text: '🗑️ Vaciar carrito', callback_data: 'empty_cart' }, { text: '✏️ Editar carrito', callback_data: 'edit_cart' }],
                    [{ text: '⬅️ Volver', callback_data: 'back_to_language' }]
                ] :
                [[{ text: '⬅️ Volver', callback_data: 'back_to_language' }]];
        
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
    
        } catch (error) {
            console.error(`Error al eliminar el artículo del carrito: ${error}`);
            // Notifica al usuario con un mensaje emergente en caso de error
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `Hubo un error al eliminar el artículo del carrito.`,
                show_alert: true
            });
        }
    }
    
    else if (data.startsWith('add_to_cart_')) {
        const productId = data.split('_')[3];
        const numericKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '1', callback_data: `quantity_${productId}_1` }, { text: '2', callback_data: `quantity_${productId}_2` }, { text: '3', callback_data: `quantity_${productId}_3` }],
                    [{ text: '4', callback_data: `quantity_${productId}_4` }, { text: '5', callback_data: `quantity_${productId}_5` }, { text: '6', callback_data: `quantity_${productId}_6` }],
                    [{ text: '7', callback_data: `quantity_${productId}_7` }, { text: '8', callback_data: `quantity_${productId}_8` }, { text: '9', callback_data: `quantity_${productId}_9` }],
                    [{ text: '🔙', callback_data: `quantity_${productId}_delete` }, { text: '0', callback_data: `quantity_${productId}_0` }, { text: '✅ Aceptar', callback_data: `confirm_add_${productId}` }],
                    [{ text: '❌ Cancelar', callback_data: `cancel_add_${productId}` }]
                ]
            }
        };
        
        // Asegurarse de que el estado del usuario está inicializado
        userStates[chatId] = userStates[chatId] || {
            productMessages: [],
            awaitingQuantityFor: productId,
            awaitingQuantityMessageId: null,
            currentQuantity: '' // Agregamos una nueva propiedad para rastrear la cantidad actual
        };
        
        // Eliminar mensajes antiguos de productos
        for (const messageId of userStates[chatId].productMessages) {
            try {
                await bot.deleteMessage(chatId, messageId);
            } catch (error) {
                console.error(`Error al eliminar mensaje: ${error}`);
            }
        }
        userStates[chatId].productMessages = [];
        
        try {
            const sentMessage = await bot.editMessageText(`Selecciona la cantidad para añadir al carrito:`, {
                chat_id: chatId,
                message_id: userStates[chatId].categoryMessageId,
                ...numericKeyboard
            });
            userStates[chatId].awaitingQuantityMessageId = sentMessage.message_id;
        } catch (error) {
            console.error(`Error al editar mensaje con teclado numérico: ${error}`);
        }
    }
    
    // Handler para el teclado numérico personalizado
    else if (data.startsWith('quantity_')) {
        const parts = data.split('_');
        const productId = parts[1];
    
        // Inicializar userStates para el chatId si no existe
        if (!userStates[chatId]) {
            userStates[chatId] = {};
        }
    
        // Inicializar currentQuantity si no existe
        if (!userStates[chatId].currentQuantity) {
            userStates[chatId].currentQuantity = '';
        }
    
        if (parts[2] === 'delete') {
            // Si es una acción de borrar y currentQuantity tiene longitud, removemos el último dígito
            if (userStates[chatId].currentQuantity.length > 0) {
                userStates[chatId].currentQuantity = userStates[chatId].currentQuantity.slice(0, -1);
            }
        } else {
            // Agregar el dígito a currentQuantity
            const digit = parts[2];
            userStates[chatId].currentQuantity += digit;
        }
        
        // Construimos el teclado numérico
        const numericKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '1', callback_data: `quantity_${productId}_1` }, { text: '2', callback_data: `quantity_${productId}_2` }, { text: '3', callback_data: `quantity_${productId}_3` }],
                    [{ text: '4', callback_data: `quantity_${productId}_4` }, { text: '5', callback_data: `quantity_${productId}_5` }, { text: '6', callback_data: `quantity_${productId}_6` }],
                    [{ text: '7', callback_data: `quantity_${productId}_7` }, { text: '8', callback_data: `quantity_${productId}_8` }, { text: '9', callback_data: `quantity_${productId}_9` }],
                    [{ text: '⬅️', callback_data: `quantity_${productId}_delete` }, { text: '0', callback_data: `quantity_${productId}_0` }, { text: 'Aceptar', callback_data: `confirm_add_${productId}` }],
                    [{ text: 'Cancelar', callback_data: `cancel_add_${productId}` }]
                ]
            }
        };
    
        // Intentamos actualizar el mensaje con el teclado numérico
        try {
            await bot.editMessageText(`Selecciona la cantidad para añadir al carrito: ${userStates[chatId].currentQuantity}`, {
                chat_id: chatId,
                message_id: userStates[chatId].awaitingQuantityMessageId,
                reply_markup: numericKeyboard.reply_markup
            });
        } catch (error) {
            console.error(`Error al actualizar mensaje con la cantidad: ${error}`);
        }
    }
    
    
    
    // Handler para confirmar la adición al carrito
    else if (data.startsWith('confirm_add_')) {
        const productId = data.split('_')[2];
        const quantity = userStates[chatId].currentQuantity; // Asumimos que la cantidad actual se ha almacenado aquí
    
        try {
            // Lógica para añadir el producto al carrito
            await cartController.addToCart(chatId, productId, parseInt(quantity, 10));
    
            // Notificación al usuario del éxito de la operación
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `Producto añadido al carrito. Cantidad: ${quantity}.`,
                show_alert: false
            });
    
            // Elimina los mensajes de los productos si existen
            if (userStates[chatId] && userStates[chatId].productMessages) {
                for (const messageId of userStates[chatId].productMessages) {
                    await bot.deleteMessage(chatId, messageId).catch(error => console.error(`No se pudo eliminar el mensaje: ${error}`));
                }
                userStates[chatId].productMessages = []; // Limpia el array después de eliminar los mensajes
            }
    
            // Obtiene las categorías para volver a mostrar el catálogo
            const categories = await catalogController.getCategories();
            const categoryButtons = categories.map(category => {
                // Cada botón lleva al usuario a la lista de productos de esa categoría
                return [{ text: `${category.icon} ${category.name.toUpperCase()}`, callback_data: `category_${category.id}` }];
            });
    
            // Añade un botón de volver
            categoryButtons.push([{ text: 'Volver', callback_data: 'back_to_language' }]);
    
            // Edita el mensaje actual para mostrar el catálogo
            await bot.editMessageText('CATÁLOGO', {
                chat_id: chatId,
                message_id: userStates[chatId].categoryMessageId, // Asegúrate de que esto es el ID correcto del mensaje del catálogo
                reply_markup: { inline_keyboard: categoryButtons }
            });
    
            // Limpieza: resetear el estado actual del usuario relacionado con la adición de productos
            userStates[chatId].currentQuantity = '';
            userStates[chatId].awaitingQuantityFor = null;
            userStates[chatId].awaitingQuantityMessageId = null;
    
        } catch (error) {
            console.error(`Error al confirmar adición al carrito: ${error}`);
            // Notificación al usuario si hay un error
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `Hubo un error al añadir el producto al carrito. Por favor, inténtalo de nuevo.`,
                show_alert: true
            });
        }
    }

    
    else if (data.startsWith('cancel_add')) {
        try {
            // Notificar al usuario que la adición fue cancelada
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Adición al carrito cancelada.',
                show_alert: false
            });
    
            // Lógica para mostrar el catálogo
            const categories = await catalogController.getCategories();
            const categoryButtons = categories.map(category => {
                return [{ text: `${category.icon} ${category.name.toUpperCase()}`, callback_data: `category_${category.id}` }];
            });
            categoryButtons.push([{ text: 'Volver', callback_data: 'back_to_language' }]);
    
            await bot.editMessageText('CATÁLOGO', {
                chat_id: chatId,
                message_id: userStates[chatId].categoryMessageId, // Asegúrate de usar el correcto message_id aquí
                reply_markup: { inline_keyboard: categoryButtons }
            });
            
        } catch (error) {
            console.error(`Error al cancelar adición al carrito: ${error}`);
        }
    }

    else if (data === 'process_order') {
        try {
            let messageText = 'Elige tu método de pago:\n';
    
            const keyboard = [
                [{ text: 'CryptoWallet', callback_data: 'payment_cryptowallet' }],
                [{ text: 'Contra reembolso', callback_data: 'payment_cash' }],
                [{ text: 'Volver', callback_data: 'view_cart' }] // Permite al usuario volver atrás
            ];
    
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        } catch (error) {
            console.error(`Error al tramitar el pedido: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al tramitar el pedido.");
        }
    }
    
    else if (data.startsWith('payment_cash')) {
        try {
            // Extraer el método de pago del callback data
            const paymentMethod = data.split('_')[1]; // 'cash' o 'cryptowallet'
            chatStates[chatId] = {
                ...chatStates[chatId],
                paymentMethod: paymentMethod,
                awaitingAddress: true // Indicar que ahora esperamos una dirección
            };
    
            let messageText = 'Selecciona tu país de entrega:\n';
            const keyboard = [
                [{ text: 'Alemania', callback_data: 'select_country_Germany' }],
                // ... puedes agregar más países aquí
                [{ text: 'Volver', callback_data: 'process_order' }] // Permite al usuario cambiar el método de pago
            ];
    
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        } catch (error) {
            console.error(`Error al seleccionar método de pago: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al seleccionar el método de pago.");
        }
    }
    else if (data.startsWith('payment_cryptowallet')) {
        try {
            // Extraer el método de pago del callback data
            const paymentMethod = data.split('_')[1]; // 'cash' o 'cryptowallet'
            chatStates[chatId] = {
                ...chatStates[chatId],
                paymentMethod: paymentMethod,
                awaitingAddress: true // Indicar que ahora esperamos una dirección
            };
    
            let messageText = 'Selecciona tu país de entrega:\n';
            const keyboard = [
                [{ text: 'EUROPA', callback_data: 'select_europe' }],
                // ... puedes agregar más países aquí
                [{ text: 'Volver', callback_data: 'process_order' }] // Permite al usuario cambiar el método de pago
            ];
    
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        } catch (error) {
            console.error(`Error al seleccionar método de pago: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al seleccionar el método de pago.");
        }
    }
    else if (data === 'select_country_Germany' || data === 'select_europe') {
        try {
            // Define 'messageText' antes de usarla.
            let messageText = `Introduce tu dirección de entrega completa incluyendo:\n` +
                    `- Calle y número\n` +
                    `- Nombre en el timbre\n` +
                    `- Nombre y apellido (no tienen por que ser reales)\n` +
                    `- Código postal\n` +
                    `- Ciudad\n` +
                    `Escribe tu dirección a continuación o selecciona "Volver" para corregir cualquier dato previo.`;
    
            // Define 'replyMarkup' antes de usarla.
            const replyMarkup = {
                inline_keyboard: [
                    [{ text: 'Volver', callback_data: 'view_cart' }]
                ]
            };
    
            // Actualizar el estado con el país seleccionado y el método de pago.
            userStates[chatId] = {
                ...userStates[chatId],
                awaitingAddress: true,
                country: data.split('_')[2],
                paymentMethod: 'cash' // Asegúrate de que esta lógica es correcta para tu flujo.
            };
    
            // Ahora edita el mensaje con el nuevo texto y los botones inline.
            const sentMessage = await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: replyMarkup
            });
    
            // Guarda el message_id del mensaje editado para futuras referencias.
            userStates[chatId].botLastMessageId = sentMessage.message_id;
        } catch (error) {
            console.error(`Error al seleccionar país de entrega: ${error}`);
            // Envía un mensaje de error si no se puede editar el mensaje.
            await bot.sendMessage(chatId, "Hubo un error al seleccionar el país de entrega.");
        }
    }
    
    
    else if (data === 'select_europe') {
        try {
            // Definir el texto del mensaje
            let messageText = `Introduce tu dirección de entrega completa incluyendo:\n` +
                              `- Calle y número\n` +
                              `- Nombre en el timbre\n` +
                              `- Nombre y apellido (no tienen por que ser reales)\n` +
                              `- Código postal\n` +
                              `- Ciudad\n` +
                              `Escribe tu dirección a continuación o selecciona "Volver" para corregir cualquier dato previo.`;
    
            // Definir el teclado inline
            const replyMarkup = {
                inline_keyboard: [
                    [{ text: 'Volver', callback_data: 'view_cart' }]
                ]
            };
    
            // Actualizar el estado con el país seleccionado y el método de pago
            userStates[chatId] = {
                ...userStates[chatId],
                awaitingAddress: true,
                country: 'Europe',
                paymentMethod: 'cryptowallet'
            };
    
            // Editar el mensaje del bot con el nuevo texto y teclado
            const sentMessage = await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: replyMarkup
            });
    
            // Guardar el ID del mensaje enviado para futuras ediciones
            userStates[chatId].botLastMessageId = sentMessage.message_id;
        } catch (error) {
            console.error(`Error al seleccionar país de entrega: ${error}`);
            // Enviar un mensaje de error si no se puede editar el mensaje
            await bot.sendMessage(chatId, "Hubo un error al seleccionar el país de entrega.");
        }
    }
    

    else if (data === 'verify_account') {
        // Solicitar al usuario su nombre de usuario de Instagram
        let inlineKeyboard = [
            [{ text: "Cancelar", callback_data: 'view_cart' }]
        ];
        await bot.editMessageText("Por favor, introduce tu nombre de usuario de Instagram (@username):", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
        
        // Establecer el próximo estado esperando el nombre de usuario de Instagram
        userStates[chatId] = {
            ...userStates[chatId],
            awaitingInstagramUsername: true
        };
    }
    else if (data === 'view_orders') {
        try {
            // Obtener los pedidos del usuario
            const orders = await orderController.getAllOrdersByUserId(chatId);
            
            // Crear un mensaje con la información de los pedidos
            let messageText = "📜 Tus pedidos:\n\n";
            for (const order of orders) {
                // Obtener los contenidos del pedido
                const orderContents = await orderController.getOrderContents(order.id);

                // Convertir la fecha a formato mes/día/año
                const fechaPedido = new Date(order.fecha);
                const fechaFormateada = fechaPedido.toLocaleDateString('es-ES', {
                    year: 'numeric', month: '2-digit', day: '2-digit'
                });

                // Asignar un ícono según el estado del pedido
                let iconoEstado;
                switch (order.estado.toLowerCase()) {
                    case 'pendiente':
                        iconoEstado = '⏳'; // Ícono de reloj de arena para 'pendiente'
                        break;
                        case 'aceptado':
                            iconoEstado = '✅'; // Ícono verde para 'aceptado'
                            break;
                            case 'rechazado':
                                iconoEstado = '❌'; // Ícono rojo para 'rechazado'
                                break;
                    // Añade más casos según sea necesario
                    default:
                        iconoEstado = '❓'; // Ícono por defecto
                    }

                    messageText += `🗓️ Fecha: ${fechaFormateada}\n📦 Productos:\n${orderContents}\nEstado del pedido: ${iconoEstado} ${order.estado.toUpperCase()}\n\n`;
                }
    
            // Botón para volver a la selección de idioma
            let inlineKeyboard = [
                [{ text: '⬅️ Volver', callback_data: 'back_to_language' }]
            ];
    
            // Enviar el mensaje con los detalles de los pedidos
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId, // Reemplaza con el message_id del mensaje original
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
    
        } catch (error) {
            console.error(`Error al mostrar pedidos: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al mostrar tus pedidos.");
        }
    }
    
    

});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    
    console.log(`Mensaje recibido de ${chatId}: `, msg.text);
    console.log(userStates[chatId]); // Para verificar el contenido de userStates

    // Manejo de la contraseña de administrador
    if (userStates[chatId] && userStates[chatId].awaitingPassword) {
        const password = msg.text;
        if (validatePassword(password)) {
            userStates[chatId].adminPasswords.push(password);
            if (userStates[chatId].adminPasswords.length < 3) {
                bot.sendMessage(chatId, `Contraseña ${userStates[chatId].adminPasswords.length} guardada. Introduce la siguiente contraseña de administrador:`);
            } else {
                // Proceder a guardar las contraseñas y luego pedir el nombre de la categoría
                try {
                    await userController.saveAdminPasswords(chatId, userStates[chatId].adminPasswords);
                    bot.sendMessage(chatId, "Todas las contraseñas han sido guardadas. ¿Cuál será el nombre de la primera categoría?");
                    userStates[chatId] = { ...userStates[chatId], awaitingCategoryName: true, awaitingPassword: false };
                } catch (error) {
                    console.error(error);
                    bot.sendMessage(chatId, "Hubo un error al guardar las contraseñas. Por favor, intenta configurar de nuevo.");
                }
            }
        } else {
            bot.sendMessage(chatId, "La contraseña no cumple con los requisitos. Debe tener al menos 10 caracteres, incluyendo letras, números y símbolos. Inténtalo de nuevo:");
        }
    }
    // Manejo del nombre de la categoría
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingCategoryName') {
        userStates[chatId].categoryName = msg.text; // Guardamos el nombre de la categoría
        userStates[chatId].step = 'awaitingCategoryIcon'; // Actualizamos el paso a la espera del ícono
    
        // Editar el mensaje para pedir el ícono usando el ID del mensaje original y añadir botón de "Volver"
        const replyMarkup = {
            inline_keyboard: [
                [{ text: 'Volver', callback_data: 'manage_categories' }]
            ]
        };
    
        await bot.editMessageText("Por favor, introduce el icono para la nueva categoría:", {
            chat_id: chatId,
            message_id: userStates[chatId].categoryMessageId, // Usamos el ID del mensaje guardado
            reply_markup: replyMarkup
        });
    }
    // Manejo del icono de la categoría
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingCategoryIcon') {
        const categoryIcon = msg.text.trim();
    
        if (!categoryIcon) {
            // Editar el mensaje existente pidiendo el icono y mantener el botón de "Volver"
            const replyMarkup = {
                inline_keyboard: [
                    [{ text: 'Volver', callback_data: 'manage_categories' }]
                ]
            };
    
            await bot.editMessageText("Parece que no has enviado un icono. Por favor, envía el icono para la categoría:", {
                chat_id: chatId,
                message_id: userStates[chatId].categoryMessageId, // Asegúrate de tener el message_id del mensaje original que quieres editar
                reply_markup: replyMarkup
            });
            return;
        }
    
        try {
            await userController.saveCategory(
                chatId,
                userStates[chatId].categoryName,
                categoryIcon
            );
    
            const categoryManagementButtons = [
                [{ text: 'Añadir Categoría', callback_data: 'add_category' }],
                [{ text: 'Editar Categoría', callback_data: 'edit_category' }],
                [{ text: 'Eliminar Categoría', callback_data: 'delete_category' }],
                [{ text: 'Volver', callback_data: 'admin_panel' }],
            ];
    
            await bot.editMessageText("Categoría añadida con éxito. Gestión de Categorías:", {
                chat_id: chatId,
                message_id: userStates[chatId].categoryMessageId, // Asegúrate de que este es el ID del mensaje que quieres editar
                reply_markup: { inline_keyboard: categoryManagementButtons }
            });
    
            // Resetear el estado del usuario para permitir nuevas interacciones
            userStates[chatId] = {};
        } catch (error) {
            console.error(error);
            // Utilizar editMessageText en lugar de sendMessage para mantener la coherencia en la edición de mensajes
            await bot.editMessageText("Hubo un error al guardar la categoría. Por favor, intenta de nuevo.", {
                chat_id: chatId,
                message_id: userStates[chatId].categoryMessageId, // Asegúrate de usar el message_id correcto aquí
                reply_markup: { inline_keyboard: [[{ text: 'Volver', callback_data: 'manage_categories' }]] } // Proporciona una manera de volver al menú anterior en caso de error
            });
        }
    }
    
    // Manejo de la confirmación para añadir más categorías
    else if (userStates[chatId] && userStates[chatId].awaitingCategoryConfirmation) {
        const response = msg.text.toLowerCase();
        if (response === 'sí' || response === 'si') {
            bot.sendMessage(chatId, "Por favor, introduce el nombre de la nueva categoría:");
            userStates[chatId] = { ...userStates[chatId], awaitingCategoryName: true, awaitingCategoryConfirmation: false };
        } else if (response === 'no') {
            bot.sendMessage(chatId, "Configuración inicial completada. Puedes añadir productos a estas categorías desde el menú de administrador. Cierra la sesión y vuelve a abrirla para ver el menú de administrador.");
            userStates[chatId] = {};
        } else {
            bot.sendMessage(chatId, "Respuesta no reconocida. Por favor, responde 'Sí' para añadir otra categoría o 'No' para finalizar.");
        }
    } else // Verificar si el usuario está en el paso de ingresar el nombre del producto para añadir
    if (userStates[chatId] && userStates[chatId].step === 'awaitingProductName') {
        const productName = msg.text;
        userStates[chatId].productName = productName; // Guardar el nombre en el estado
        userStates[chatId].step = 'awaitingProductPrice'; // Cambiar el paso al precio

        // Pedir al usuario que introduzca el precio
        await bot.sendMessage(chatId, "Por favor, introduce el precio del producto en €:");
    }
    // Verificar si el usuario está en el paso de ingresar el precio del producto para añadir
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingProductPrice') {
        const productPrice = msg.text;
        userStates[chatId].productPrice = productPrice; // Guardar el precio en el estado
        userStates[chatId].step = 'awaitingProductPhoto'; // Cambiar el paso a la foto

        // Pedir al usuario que envíe la foto del producto
        await bot.sendMessage(chatId, "Por favor, envía la foto del producto:");
    }
    //manejo de editar nuevo producto
    else // Verificar si el usuario está en el paso de ingresar el nuevo nombre del producto
    if (userStates[chatId] && userStates[chatId].step === 'awaitingProductNameEdit') {
        const newName = msg.text;
        userStates[chatId].newProductName = newName; // Guardar el nuevo nombre en el estado
        userStates[chatId].step = 'awaitingProductPriceEdit'; // Cambiar el paso al precio

        // Pedir al usuario que introduzca el nuevo precio
        await bot.sendMessage(chatId, "Por favor, introduce el nuevo precio del producto en €:");
    }
    // Verificar si el usuario está en el paso de ingresar el nuevo precio del producto
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingProductPriceEdit') {
        const newPrice = msg.text;
        userStates[chatId].newProductPrice = newPrice; // Guardar el nuevo precio en el estado
        userStates[chatId].step = 'awaitingProductPhotoEdit'; // Cambiar el paso a la foto

        // Pedir al usuario que envíe la nueva foto del producto
        await bot.sendMessage(chatId, "Por favor, envía la nueva foto del producto:");
    }

    //añadir categorias desde gestion categorias
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingCategoryName') {
        userStates[chatId].categoryName = msg.text;
        userStates[chatId].step = 'awaitingCategoryIcon';
        await bot.sendMessage(chatId, "Por favor, introduce el icono para la nueva categoría:");
    } else if (userStates[chatId] && userStates[chatId].step === 'awaitingCategoryIcon') {
        const categoryIcon = msg.text.trim();
    
        // Verifica que el usuario realmente ha enviado un icono y no un mensaje vacío
        if (!categoryIcon) {
            await bot.sendMessage(chatId, "Parece que no has enviado un icono. Por favor, envía el icono para la categoría:");
            return; // Detiene la ejecución adicional para que el usuario pueda responder
        }
    
        // Si hay un icono, intenta guardar la categoría
        try {
            await userController.saveCategory(
                chatId, // O el telegramId del usuario, si es diferente
                userStates[chatId].categoryName,
                categoryIcon
            );
            await bot.sendMessage(chatId, "Categoría añadida con éxito.");
        } catch (error) {
            console.error(`Error al añadir categoría: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al añadir la categoría. Asegúrate de enviar un icono válido.");
        }
        // Limpiar el estado y mostrar nuevamente el menú de gestión de categorías
        delete userStates[chatId];
        const categoryManagementButtons = [
            [{ text: 'Añadir Categoría', callback_data: 'add_category' }],
            [{ text: 'Editar Categoría', callback_data: 'edit_category' }],
            [{ text: 'Eliminar Categoría', callback_data: 'delete_category' }],
            [{ text: 'Volver', callback_data: 'admin_panel' }],
        ];
        await bot.sendMessage(chatId, 'Gestión de Categorías', {
            reply_markup: { inline_keyboard: categoryManagementButtons }
        });
    }

    else if (userStates[chatId] && userStates[chatId].step === 'awaitingNewCategoryName') {
        userStates[chatId].newCategoryName = msg.text;
        userStates[chatId].step = 'awaitingNewCategoryIcon';
        await bot.sendMessage(chatId, "Por favor, introduce el nuevo icono para la categoría:");
    }
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingNewCategoryIcon') {
        userStates[chatId].newCategoryIcon = msg.text;

        try {
            await catalogController.updateCategory(
                userStates[chatId].categoryId,
                userStates[chatId].newCategoryName,
                userStates[chatId].newCategoryIcon
            );
            await bot.sendMessage(chatId, "Categoría actualizada con éxito.");
        } catch (error) {
            console.error(`Error al actualizar categoría: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al actualizar la categoría.");
        }

        delete userStates[chatId];

        // Mostrar nuevamente el menú de gestión de categorías
        const categoryManagementButtons = [
            [{ text: 'Añadir Categoría', callback_data: 'add_category' }],
            [{ text: 'Editar Categoría', callback_data: 'edit_category' }],
            [{ text: 'Eliminar Categoría', callback_data: 'delete_category' }],
            [{ text: 'Volver', callback_data: 'admin_panel' }],
        ];
        await bot.sendMessage(chatId, 'Gestión de Categorías', {
            reply_markup: { inline_keyboard: categoryManagementButtons }
        });
    }

     // Verifica si el usuario está en el paso de ingresar la contraseña de admin.
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingAdminPassword') {
        const providedPassword = msg.text;
        // Aquí llamarías a tu función que verifica la contraseña de admin
        const isAdminPasswordValid = await userController.verifyAdminPassword(providedPassword, chatId);
        if (isAdminPasswordValid) {
            // Si la contraseña es correcta, actualiza el usuario a admin en la base de datos
            await userController.makeUserAdmin(chatId);
            await bot.sendMessage(chatId, "¡Felicidades! Ahora eres administrador del bot.");

            // Aquí obtienes la información del usuario nuevamente para verificar el idioma y si es admin o owner
            const user = await userController.getUser(chatId);
            const flagEmoji = getFlagEmoji(user.language);
            const isAdminOrOwner = await userController.checkAdminOrOwner(chatId);

            let inlineKeyboard = [
                [{ text: "🇬🇧", callback_data: 'language_GB' },
                 { text: "🇩🇪", callback_data: 'language_DE' },
                 { text: "🇫🇷", callback_data: 'language_FR' },
                 { text: "🇪🇸", callback_data: 'language_ES' }]
            ];

            if (userLanguage) {
                inlineKeyboard.push([{ text: "📚 Catálogo", callback_data: 'show_catalog' }]);
                inlineKeyboard.push([{ text: "🛒 Carrito", callback_data: 'view_cart' }]);
                inlineKeyboard.push([{ text: "📦 Pedidos", callback_data: 'view_orders' }]);
            }
    
            if (isAdminOrOwner) {
                inlineKeyboard.push([{ text: "🛠️ Administrador", callback_data: 'admin_panel' }]);
            }

            // Muestra el menú principal con los nuevos botones de admin
            await bot.sendMessage(chatId, `Idioma seleccionado: ${flagEmoji}`, {
                reply_markup: { inline_keyboard: inlineKeyboard }
            });

        } else {
            await bot.sendMessage(chatId, "Contraseña incorrecta o ha expirado.");
        }
        // Limpia el estado del usuario independientemente de si la contraseña era válida o no
        delete userStates[chatId];
    }

    else if (userStates[chatId] && userStates[chatId].awaitingQuantityFor) {
        const quantity = parseInt(msg.text, 10);

        if (!isNaN(quantity) && quantity > 0) {
            // Si la cantidad es válida, pide confirmación
            const productId = userStates[chatId].awaitingQuantityFor;
            let confirmMarkup = {
                inline_keyboard: [
                    [{ text: 'Confirmar', callback_data: `confirm_add_${productId}_${quantity}` }],
                    [{ text: 'Cancelar', callback_data: `cancel_add_${productId}` }]
                ]
            };
            try {
                await bot.editMessageText(`Has seleccionado ${quantity} unidad(es). ¿Quieres añadirlo al carrito?`, {
                    chat_id: chatId,
                    message_id: userStates[chatId].categoryMessageId,
                    reply_markup: confirmMarkup
                });
                // Limpia el estado de espera por cantidad
                delete userStates[chatId].awaitingQuantityFor;
            } catch (error) {
                console.error(`Error al confirmar cantidad: ${error}`);
            }
        } else {
            await bot.sendMessage(chatId, "Por favor, introduce un número válido.");
        }
    }

    else if (userStates[chatId] && userStates[chatId].awaitingAddress) {
        console.log('El usuario está enviando su dirección, procesando...');
        const userAddress = msg.text;
        const { country, paymentMethod } = userStates[chatId];

        try {
            const userCartItems = await cartController.getCartItemsForOrder(chatId);
            const orderId = await orderController.createOrder(chatId, userAddress, country, paymentMethod, userCartItems);
            console.log(`Pedido creado con ID: ${orderId}`);
            const user = await userController.getUser(chatId);

            if (user && user.is_verified) {
                // Enviar una notificación emergente al usuario
                await bot.answerCallbackQuery(userStates[chatId].callbackQueryId, {
                    text: "Tu pedido está pendiente de confirmación por la administración.",
                    show_alert: true
                });
            } else {
                // El usuario no está verificado, editar el mensaje para incluir botones de verificación o cancelar
                let inlineKeyboard = [
                    [{ text: "Verificar cuenta", callback_data: 'verify_account' }],
                    [{ text: "Cancelar", callback_data: 'view_cart' }]
                ];
        
                await bot.editMessageText("Como es tu primera compra y no eres un usuario verificado, tendrás que verificarte.", {
                    chat_id: chatId,
                    message_id: userStates[chatId].botLastMessageId,
                    reply_markup: { inline_keyboard: inlineKeyboard }
                });

                // Establecer el próximo estado esperando la acción de verificación
                userStates[chatId].awaitingVerificationAction = true;
            }
        } catch (error) {
            console.error(`Error al crear el pedido: ${error}`);
            // Si ocurre un error, informa al usuario y no intentes editar el mensaje
            await bot.sendMessage(chatId, "Hubo un error al crear tu pedido. Por favor, inténtalo de nuevo.");
        }

        // Elimina el estado de awaitingAddress después de manejar la dirección
        delete userStates[chatId].awaitingAddress;
    }
    else if (userStates[chatId] && userStates[chatId].awaitingInstagramUsername) {
        const instagramUsername = msg.text; // Captura el nombre de usuario de Instagram
        let inlineKeyboard = [
            [{ text: "Cancelar verificación", callback_data: 'cancel_verification' }]
        ];
        await bot.sendMessage(chatId, "Por favor, envía una foto tuya sosteniendo un cartel con la fecha y hora actual. La foto debe ser tomada hace menos de una hora.", {
            reply_markup: { inline_keyboard: inlineKeyboard }
        });

        // Actualizar el estado para esperar la foto de verificación
        userStates[chatId] = {
            ...userStates[chatId],
            awaitingVerificationPhoto: true,
            instagramUsername: instagramUsername
        };
    } else if (userStates[chatId] && userStates[chatId].awaitingVerificationPhoto) {
        // Si el usuario envía una foto, esta lógica se manejará en el evento 'photo'
        // Aquí puedes añadir alguna respuesta si el usuario no envía una foto
    }


    
});

// Evento para manejar la recepción de fotos (por ejemplo, para la adición de productos)
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;

    // Lógica para añadir un nuevo producto
    if (userStates[chatId] && userStates[chatId].step === 'awaitingProductPhoto') {
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        try {
            await productController.addProduct(
                userStates[chatId].productName,
                userStates[chatId].selectedCategory,
                userStates[chatId].productPrice,
                photoId
            );
            await bot.sendMessage(chatId, "Producto añadido con éxito.");
        } catch (error) {
            console.error(`Error al añadir producto: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al añadir el producto.");
        }

        // Limpiar el estado del usuario
        delete userStates[chatId];

        // Mostrar los botones del menú de administrador
        const adminMenuButtons = getAdminMenuButtons();
        await bot.sendMessage(chatId, "Menú de Administrador", {
            reply_markup: { inline_keyboard: adminMenuButtons }
        });
    }

    // Lógica para editar un producto existente
    else if (userStates[chatId] && userStates[chatId].step === 'awaitingProductPhotoEdit') {
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        try {
            // Utiliza la categoría almacenada en el estado del usuario para la actualización del producto
            await productController.updateProduct(
                userStates[chatId].editingProductId,
                userStates[chatId].newProductName,
                userStates[chatId].selectedCategory, // Usa la categoría almacenada
                userStates[chatId].newProductPrice,
                photoId
            );
            await bot.sendMessage(chatId, "Producto editado con éxito.");

            // Limpiar el estado del usuario
            delete userStates[chatId];

            // Mostrar los botones del menú de gestión de stock
            const stockButtons = getAdminMenuButtons();
            await bot.sendMessage(chatId, "Admin Menu", {
                reply_markup: { inline_keyboard: stockButtons }
            });

        } catch (error) {
            console.error(`Error al editar producto: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al editar el producto.");
        }
    }

    // Lógica para manejar la foto de verificación
    else if (userStates[chatId] && userStates[chatId].awaitingVerificationPhoto) {
        const photoId = msg.photo[msg.photo.length - 1].file_id;

        // Aquí puedes añadir lógica para validar la foto, como la comprobación de la hora

        try {
            // Guardar la información de verificación en la base de datos
            await orderController.verifyUser(
                chatId,
                userStates[chatId].instagramUsername,
                photoId
            );

            // Marcar el usuario como verificado
            await orderController.setUserVerified(chatId);

            // Notificar al usuario
            await bot.sendMessage(chatId, "Tu cuenta ha sido verificada. Tu pedido está pendiente de confirmación por la administración.");

            // Limpiar el estado del usuario
            delete userStates[chatId];
        } catch (error) {
            console.error(`Error al verificar usuario: ${error}`);
            await bot.sendMessage(chatId, "Hubo un error al verificar tu cuenta. Por favor, inténtalo de nuevo.");
        }
    }
});




module.exports = bot;
