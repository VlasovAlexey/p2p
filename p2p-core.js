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
            iceCandidatePoolSize: 10
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
            channel.send(message);
            return true;
        }
        return false;
    }
    
    // Рассылка сообщения всем подключенным пирам
    broadcastToPeers(message) {
        this.dataChannels.forEach((channel, peerId) => {
            if (channel.readyState === 'open') {
                channel.send(message);
            }
        });
    }
    
    // Обработка входящих сообщений
    handleIncomingMessage(data, peerId) {
        try {
            const message = JSON.parse(data);
            
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
            }
            
        } catch (error) {
            console.error('Ошибка обработки входящего сообщения:', error);
        }
    }
    
    // Генерация ID для сообщения
    generateMessageId() {
        return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
    
    // Отправка файла
    async sendFile(file) {
        try {
            const fileData = await this.readFileAsDataURL(file);
            
            const fileMessage = {
                type: 'file',
                fileData: {
                    id: 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: fileData,
                    url: fileData
                },
                sender: this.localPeerId,
                timestamp: Date.now()
            };
            
            this.files.set(fileMessage.fileData.id, fileMessage.fileData);
            
            const messageWithId = {
                id: this.generateMessageId(),
                type: 'file',
                fileId: fileMessage.fileData.id,
                sender: this.localPeerId,
                timestamp: Date.now()
            };
            
            this.addMessageToHistory(messageWithId);
            this.broadcastToPeers(JSON.stringify(fileMessage));
            
            this.updateUI();
            console.log(`Отправлен файл: ${file.name}`);
            
        } catch (error) {
            console.error('Ошибка отправки файла:', error);
            this.showMessageModal('Ошибка', 'Ошибка отправки файла');
        }
    }
    
    // Чтение файла как Data URL
    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}
