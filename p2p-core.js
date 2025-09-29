﻿// Основной класс P2P клиента - ядро системы
class P2PClient {
    constructor() {
        this.localPeerId = this.generatePeerId();
        this.connections = new Map(); // ID пира -> RTCPeerConnection
        this.dataChannels = new Map(); // ID пира -> RTCDataChannel
        this.peers = new Map(); // Все известные пиры с метаданными
        this.connectedPeers = new Set(); // Только подключенные пиры
        
        // Конфигурация WebRTC с STUN серверами Google
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            // Увеличиваем таймауты для стабильности
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
        
        // Состояние приложения
        this.isOnline = false;
        this.messages = [];
        this.files = new Map();
        this.pendingOffer = null; // Ожидающее ответа предложение
        
        // Для синхронизации и восстановления
        this.lastSyncTime = 0;
        this.peerStates = new Map(); // Состояния пиров для синхронизации
        this.reconnectAttempts = new Map(); // Количество попыток переподключения
        this.maxReconnectAttempts = 5;
        this.reconnectTimeout = 500; // 500 мс между попытками
        
        // Для модальных окон
        this.reconnectModal = null;
        this.creatingOfferModal = null;
        this.messageModal = null;
        this.reconnectInProgress = false;
        this.reconnectStartTime = 0;
        this.offerCreationInProgress = false;
        
        // Для мигания индикатора
        this.blinkInterval = null;

        // Для управления передачей файлов
        this.fileTransfers = new Map(); // transferId -> transferData
        this.chunkSize = 16 * 1024; // 16KB chunks для стабильности
        this.maxFileSize = 100 * 1024 * 1024; // 100MB максимальный размер файла
        
        this.init();
    }
    
    // Инициализация приложения
    init() {
        this.loadFromStorage();
        this.setupEventListeners();
        this.setupModals();
        this.updateUI();
        this.startPeerMonitoring();
        
        // Автоматическое восстановление соединений при старте
        this.autoReconnectOnStart();
        
        console.log(`P2P клиент инициализирован с ID: ${this.localPeerId}`);
    }
    
    // Генерация уникального ID для пира
    generatePeerId() {
        const savedId = localStorage.getItem('peerId');
        if (savedId) return savedId;
        
        const newId = 'peer_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('peerId', newId);
        return newId;
    }
    
    // Настройка обработчиков событий соединения
    setupConnectionHandlers(connection, peerId) {
        // Обработчик ICE кандидатов
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Новый ICE кандидат для ${peerId}:`, event.candidate);
            } else {
                console.log(`Все ICE кандидаты собраны для ${peerId}`);
            }
        };
        
        // Обработчик изменения состояния соединения
        connection.onconnectionstatechange = () => {
            console.log(`Состояние соединения с ${peerId}: ${connection.connectionState}`);
            
            if (connection.connectionState === 'connected') {
                this.connectedPeers.add(peerId);
                this.isOnline = true;
                this.reconnectAttempts.set(peerId, 0); // Сбрасываем счетчик попыток
                this.updateUI();
                
                // Синхронизируем историю после подключения
                this.syncWithPeer(peerId);
            } else if (connection.connectionState === 'disconnected' || 
                      connection.connectionState === 'failed') {
                this.connectedPeers.delete(peerId);
                if (this.connectedPeers.size === 0) {
                    this.isOnline = false;
                }
                this.updateUI();
                
                // Пытаемся переподключиться
                if (!this.reconnectInProgress) {
                    setTimeout(() => {
                        this.reconnectToPeer(peerId);
                    }, this.reconnectTimeout);
                }
            }
        };

        // Обработчик ICE соединения
        connection.oniceconnectionstatechange = () => {
            console.log(`ICE состояние соединения с ${peerId}: ${connection.iceConnectionState}`);
            
            if (connection.iceConnectionState === 'failed') {
                console.log(`ICE соединение с ${peerId} завершилось ошибкой, пытаемся восстановить...`);
                // Пытаемся пересоздать предложение
                if (!this.reconnectInProgress) {
                    setTimeout(() => {
                        this.reconnectToPeer(peerId);
                    }, this.reconnectTimeout);
                }
            }
        };
    }
    
    // Настройка канала данных
    setupDataChannel(channel, peerId) {
        channel.onopen = () => {
            console.log(`Канал данных открыт с пиром: ${peerId}`);
            this.connectedPeers.add(peerId);
            this.isOnline = true;
            this.updateUI();
        };
        
        channel.onclose = () => {
            console.log(`Канал данных закрыт с пиром: ${peerId}`);
            this.connectedPeers.delete(peerId);
            
            if (this.connectedPeers.size === 0) {
                this.isOnline = false;
            }
            
            this.updateUI();
            
            // Пытаемся переподключиться
            if (!this.reconnectInProgress) {
                setTimeout(() => {
                    this.reconnectToPeer(peerId);
                }, this.reconnectTimeout);
            }
        };

        channel.onerror = (error) => {
            console.error(`Ошибка канала данных с пиром ${peerId}:`, error);
            // Не закрываем соединение при ошибке, пытаемся восстановить
        };

        // Мониторинг состояния буфера
        channel.onbufferedamountlow = () => {
            console.log(`Буфер канала с ${peerId} опустился ниже порога`);
            // Можно возобновить отправку данных если была приостановлена
        };

        channel.onmessage = (event) => {
            this.handleIncomingMessage(event.data, peerId);
        };
        
        this.dataChannels.set(peerId, channel);
    }
    
    // Запуск мониторинга пиров
    startPeerMonitoring() {
        // Проверка состояния пиров каждые 1000 мс
        setInterval(() => {
            this.checkPeersStatus();
        }, 1000);
        
        // Автоматическое обновление SDP каждые 2000 мс для поддержания соединения
        setInterval(() => {
            this.refreshConnections();
        }, 2000);

        // Проверка состояния передачи файлов
        setInterval(() => {
            this.monitorFileTransfers();
        }, 5000);
    }
    
    // Проверка состояния пиров
    checkPeersStatus() {
        this.dataChannels.forEach((channel, peerId) => {
            // Пропускаем некорректные peerId
            if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
                return;
            }
            
            const isConnected = channel.readyState === 'open';
            const wasConnected = this.connectedPeers.has(peerId);
            
            if (isConnected !== wasConnected) {
                if (isConnected) {
                    this.connectedPeers.add(peerId);
                    console.log(`Пир ${peerId} теперь онлайн`);
                    
                    // При подключении синхронизируем историю
                    this.syncWithPeer(peerId);
                } else {
                    this.connectedPeers.delete(peerId);
                    console.log(`Пир ${peerId} теперь оффлайн`);
                    
                    // Пытаемся переподключиться
                    if (!this.reconnectInProgress) {
                        setTimeout(() => {
                            this.reconnectToPeer(peerId);
                        }, this.reconnectTimeout);
                    }
                }
                
                this.updateUI();
            }
        });
        
        // Обновляем состояние сети
        this.isOnline = this.connectedPeers.size > 0;
        this.updateUI();
    }
    
    // Обновление соединений
    refreshConnections() {
        if (this.connectedPeers.size === 0) return;
        
        this.connectedPeers.forEach(peerId => {
            // Пропускаем некорректные peerId
            if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
                return;
            }
            
            const connection = this.connections.get(peerId);
            if (connection && connection.connectionState === 'connected') {
                // Для активных соединений можно обновить ICE кандидатов
                this.refreshIceCandidates(peerId);
            }
        });
    }
    
    // Обновление ICE кандидатов
    async refreshIceCandidates(peerId) {
        try {
            const connection = this.connections.get(peerId);
            if (!connection) return;
            
            // Создаем новое предложение для обновления ICE кандидатов
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            
            // Сохраняем обновленное предложение
            this.savePeerOffer(peerId, offer);
            
        } catch (error) {
            console.error(`Ошибка обновления ICE кандидатов для ${peerId}:`, error);
            
            // Если ошибка связана с SDP, очищаем сохраненное предложение
            if (error.name === 'InvalidModificationError' || error.toString().includes('SDP')) {
                console.log(`Очистка устаревшего SDP для пира ${peerId} при обновлении`);
                this.clearSavedOffer(peerId);
            }
        }
    }
    
    // Синхронизация с пиром
    syncWithPeer(peerId) {
        // Пропускаем некорректные peerId
        if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
            return;
        }
        
        // Отправляем запрос на синхронизацию
        const syncRequest = {
            type: 'sync_request',
            sender: this.localPeerId,
            timestamp: Date.now(),
            lastSync: this.lastSyncTime,
            messageCount: this.messages.length,
            fileCount: this.files.size
        };
        
        this.sendToPeer(peerId, JSON.stringify(syncRequest));
        console.log(`Отправлен запрос синхронизации пиру ${peerId}`);
    }
    
    // Отправка сообщения конкретному пиру
    sendToPeer(peerId, message) {
        const channel = this.dataChannels.get(peerId);
        if (channel && channel.readyState === 'open') {
            try {
                // Проверяем размер сообщения
                if (message.length > 256 * 1024) { // 256KB лимит
                    console.warn(`Сообщение слишком большое для отправки одним пакетом: ${message.length} байт`);
                    return false;
                }

                // Проверяем буфер перед отправкой
                if (channel.bufferedAmount > 512 * 1024) { // 512KB буфер
                    console.warn(`Буфер канала с ${peerId} переполнен: ${channel.bufferedAmount} байт`);
                    return false;
                }

                channel.send(message);
                return true;
            } catch (error) {
                console.error(`Ошибка отправки сообщения пиру ${peerId}:`, error);
                return false;
            }
        }
        return false;
    }
    
    // Рассылка сообщения всем подключенным пирам
    broadcastToPeers(message) {
        let successCount = 0;
        this.dataChannels.forEach((channel, peerId) => {
            if (channel.readyState === 'open') {
                if (this.sendToPeer(peerId, message)) {
                    successCount++;
                }
            }
        });
        return successCount > 0;
    }

    // Безопасная отправка данных с проверкой соединения
    safeSendToPeer(peerId, data, maxRetries = 3) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            
            const trySend = () => {
                attempts++;
                
                if (this.sendToPeer(peerId, data)) {
                    resolve(true);
                } else if (attempts < maxRetries) {
                    setTimeout(trySend, 100 * attempts); // Экспоненциальная задержка
                } else {
                    reject(new Error(`Не удалось отправить данные пиру ${peerId} после ${maxRetries} попыток`));
                }
            };
            
            trySend();
        });
    }
    
    // Обработка входящих сообщений
    handleIncomingMessage(data, peerId) {
        try {
            // Проверяем, является ли сообщение строкой (JSON) или объектом
            let message;
            if (typeof data === 'string') {
                message = JSON.parse(data);
            } else {
                // Если это не строка, возможно это бинарные данные
                console.warn('Получены бинарные данные, которые не могут быть обработаны');
                return;
            }
            
            if (message.type === 'text') {
                // Проверяем команду kill
                if (message.content === 'kill') {
                    console.log(`Получена команда kill от ${peerId}`);
                    this.killAllData();
                    return;
                }
                
                this.addMessageToHistory({
                    id: this.generateMessageId(),
                    type: 'text',
                    content: message.content,
                    sender: peerId,
                    timestamp: message.timestamp || Date.now()
                });
                
                console.log(`Получено сообщение от ${peerId}: ${message.content}`);
                
            } else if (message.type === 'file') {
                const fileData = message.fileData;
                this.files.set(fileData.id, fileData);
                
                this.addMessageToHistory({
                    id: this.generateMessageId(),
                    type: 'file',
                    fileId: fileData.id,
                    sender: peerId,
                    timestamp: message.timestamp || Date.now()
                });
                
                console.log(`Получен файл от ${peerId}: ${fileData.name}`);
                
            } else if (message.type === 'sync_request') {
                // Обработка запроса синхронизации
                this.handleSyncRequest(message, peerId);
            } else if (message.type === 'sync_response') {
                // Обработка ответа синхронизации
                this.handleSyncResponse(message, peerId);
            } else if (message.type === 'kill_command') {
                // Обработка команды kill от другого пира
                console.log(`Получена команда kill от ${peerId}`);
                this.killAllData();
            } else if (message.type === 'clear_chat_command') {
                // Обработка команды очистки чата от другого пира
                console.log(`Получена команда очистки чата от ${peerId}`);
                this.clearChatData();
            } else if (message.type === 'file_transfer_start') {
                // Начало передачи файла
                this.handleFileTransferStart(message, peerId);
            } else if (message.type === 'file_transfer_chunk') {
                // Получение чанка файла
                this.handleFileTransferChunk(message, peerId);
            } else if (message.type === 'file_transfer_complete') {
                // Завершение передачи файла
                this.handleFileTransferComplete(message, peerId);
            } else if (message.type === 'file_transfer_error') {
                // Ошибка передачи файла
                this.handleFileTransferError(message, peerId);
            }
            
        } catch (error) {
            console.error('Ошибка обработки входящего сообщения:', error);
        }
    }
    
    // Генерация ID для сообщения
    generateMessageId() {
        return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Генерация ID для передачи файла
    generateTransferId() {
        return 'transfer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // Отправка сообщения
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();
        
        if (!content) return;
        
        const message = {
            type: 'text',
            content: content,
            sender: this.localPeerId,
            timestamp: Date.now()
        };
        
        const messageWithId = {
            id: this.generateMessageId(),
            ...message
        };
        
        this.addMessageToHistory(messageWithId);
        this.broadcastToPeers(JSON.stringify(messageWithId));
        
        messageInput.value = '';
        
        this.updateUI();
        console.log(`Отправлено сообщение: ${content}`);
    }
    
    // Отправка файла с чанкованием
    async sendFile(file) {
        // Проверяем размер файла
        if (file.size > this.maxFileSize) {
            this.showMessageModal('Ошибка', `Файл слишком большой. Максимальный размер: ${this.formatFileSize(this.maxFileSize)}`);
            return;
        }

        try {
            const fileData = await this.readFileAsArrayBuffer(file);
            const transferId = this.generateTransferId();
            
            // Создаем метаданные передачи
            const transferData = {
                transferId: transferId,
                file: file,
                fileData: fileData,
                totalChunks: Math.ceil(fileData.byteLength / this.chunkSize),
                currentChunk: 0,
                startTime: Date.now(),
                peers: Array.from(this.connectedPeers)
            };

            this.fileTransfers.set(transferId, transferData);

            // Отправляем информацию о начале передачи всем пирам
            const startMessage = {
                type: 'file_transfer_start',
                transferId: transferId,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                totalChunks: transferData.totalChunks,
                sender: this.localPeerId,
                timestamp: Date.now()
            };

            const broadcastSuccess = this.broadcastToPeers(JSON.stringify(startMessage));
            
            if (!broadcastSuccess) {
                this.showMessageModal('Ошибка', 'Не удалось начать передачу файла. Проверьте соединение.');
                this.fileTransfers.delete(transferId);
                return;
            }

            console.log(`Начата передача файла: ${file.name}, чанков: ${transferData.totalChunks}`);

            // Начинаем отправку чанков
            this.sendNextChunk(transferId);

        } catch (error) {
            console.error('Ошибка отправки файла:', error);
            this.showMessageModal('Ошибка', 'Ошибка отправки файла: ' + error.message);
        }
    }

    // Отправка следующего чанка файла
    async sendNextChunk(transferId) {
        const transfer = this.fileTransfers.get(transferId);
        if (!transfer) return;

        if (transfer.currentChunk >= transfer.totalChunks) {
            // Все чанки отправлены
            this.completeFileTransfer(transferId);
            return;
        }

        const start = transfer.currentChunk * this.chunkSize;
        const end = Math.min(start + this.chunkSize, transfer.fileData.byteLength);
        const chunk = transfer.fileData.slice(start, end);

        try {
            // Конвертируем ArrayBuffer в base64 для передачи
            const base64Chunk = await this.arrayBufferToBase64(chunk);
            
            const chunkMessage = {
                type: 'file_transfer_chunk',
                transferId: transferId,
                chunkIndex: transfer.currentChunk,
                totalChunks: transfer.totalChunks,
                data: base64Chunk,
                sender: this.localPeerId,
                timestamp: Date.now()
            };

            const messageString = JSON.stringify(chunkMessage);
            
            // Отправляем всем пирам
            const success = this.broadcastToPeers(messageString);
            
            if (success) {
                transfer.currentChunk++;
                console.log(`Отправлен чанк ${transfer.currentChunk}/${transfer.totalChunks} для передачи ${transferId}`);
                
                // Отправляем следующий чанк с небольшой задержкой для стабильности
                setTimeout(() => {
                    this.sendNextChunk(transferId);
                }, 10);
            } else {
                console.warn(`Не удалось отправить чанк ${transfer.currentChunk} для передачи ${transferId}, повтор через 1 секунду`);
                setTimeout(() => {
                    this.sendNextChunk(transferId);
                }, 1000);
            }

        } catch (error) {
            console.error(`Ошибка отправки чанка ${transfer.currentChunk}:`, error);
            this.handleFileTransferError(transferId, error.message);
        }
    }

    // Завершение передачи файла
    async completeFileTransfer(transferId) {
        const transfer = this.fileTransfers.get(transferId);
        if (!transfer) return;

        const completeMessage = {
            type: 'file_transfer_complete',
            transferId: transferId,
            sender: this.localPeerId,
            timestamp: Date.now()
        };

        this.broadcastToPeers(JSON.stringify(completeMessage));

        // Сохраняем файл локально
        const fileData = {
            id: transferId,
            name: transfer.file.name,
            type: transfer.file.type,
            size: transfer.file.size,
            data: await this.arrayBufferToDataURL(transfer.fileData, transfer.file.type),
            url: await this.arrayBufferToDataURL(transfer.fileData, transfer.file.type)
        };

        this.files.set(transferId, fileData);

        // Добавляем сообщение в историю
        this.addMessageToHistory({
            id: this.generateMessageId(),
            type: 'file',
            fileId: transferId,
            sender: this.localPeerId,
            timestamp: Date.now()
        });

        this.fileTransfers.delete(transferId);
        
        const duration = Date.now() - transfer.startTime;
        console.log(`Передача файла завершена: ${transfer.file.name}, время: ${duration}ms`);
        
        this.updateUI();
    }

    // Обработка ошибки передачи файла
    handleFileTransferError(transferId, error) {
        const transfer = this.fileTransfers.get(transferId);
        if (!transfer) return;

        const errorMessage = {
            type: 'file_transfer_error',
            transferId: transferId,
            error: error,
            sender: this.localPeerId,
            timestamp: Date.now()
        };

        this.broadcastToPeers(JSON.stringify(errorMessage));

        this.fileTransfers.delete(transferId);
        console.error(`Ошибка передачи файла ${transferId}:`, error);
        this.showMessageModal('Ошибка', `Ошибка передачи файла: ${error}`);
    }

    // Мониторинг передачи файлов
    monitorFileTransfers() {
        const now = Date.now();
        this.fileTransfers.forEach((transfer, transferId) => {
            // Если передача длится больше 5 минут, отменяем её
            if (now - transfer.startTime > 5 * 60 * 1000) {
                console.warn(`Передача ${transferId} превысила время ожидания, отменяем`);
                this.handleFileTransferError(transferId, 'Timeout');
            }
        });
    }
    
    // Чтение файла как ArrayBuffer
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // Конвертация ArrayBuffer в base64
    arrayBufferToBase64(buffer) {
        return new Promise((resolve) => {
            const blob = new Blob([buffer]);
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            reader.readAsDataURL(blob);
        });
    }

    // Конвертация ArrayBuffer в DataURL
    arrayBufferToDataURL(buffer, mimeType) {
        return new Promise((resolve) => {
            const blob = new Blob([buffer], { type: mimeType });
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    // Очистка данных чата (без удаления пиров)
    clearChatData() {
        this.messages = [];
        this.files.clear();
        this.lastSyncTime = Date.now();
        this.saveToStorage();
        this.updateUI();
        console.log('Данные чата очищены');
    }
}