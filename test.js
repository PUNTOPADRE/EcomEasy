require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const userController = require('./controllers/userController');

...

let pendingOrdersMessageIds = [];
let acceptedOrdersMessageIds = [];
let canceledOrdersMessageIds = [];

...

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
    
    ...

    ...

    if (data === 'manage_orders') {
        // Eliminar mensajes de pedidos pendientes
        for (const messageId of pendingOrdersMessageIds) {
            await bot.deleteMessage(chatId, messageId).catch(error => console.log(`Error deleting message: ${error.toString()}`));
        }
        pendingOrdersMessageIds = [];
    
        // Eliminar mensajes de pedidos aceptados
        for (const messageId of acceptedOrdersMessageIds) {
            await bot.deleteMessage(chatId, messageId).catch(error => console.log(`Error deleting message: ${error.toString()}`));
        }
        acceptedOrdersMessageIds = [];
    
        // Eliminar mensajes de pedidos cancelados
        for (const messageId of canceledOrdersMessageIds) {
            await bot.deleteMessage(chatId, messageId).catch(error => console.log(`Error deleting message: ${error.toString()}`));
        }
        canceledOrdersMessageIds = [];
    
        // Botones para la gestión de pedidos
        const orderManagementButtons = [
            [{ text: '⏳ Pendientes', callback_data: 'orders_pending' }],
            [{ text: '✅ Aceptados', callback_data: 'orders_accepted' }],
            [{ text: '❌ Rechazados', callback_data: 'orders_reject' }],
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
    
    else if (data === 'orders_reject') {
        const canceledOrders = await orderController.getCanceledOrders();
        await bot.editMessageText("📜 PEDIDOS RECHAZADOS", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Volver", callback_data: 'manage_orders' }]
                ]
            }
        });
    
        if (canceledOrders.length === 0) {
            await bot.sendMessage(chatId, "No hay pedidos rechazados.");
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
    }
    else if (data.startsWith('reject_order_')) {
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


    ...
