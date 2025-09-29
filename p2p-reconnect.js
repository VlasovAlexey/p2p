﻿// Функционал восстановления соединений
P2PClient.prototype.autoReconnectOnStart = async function() {
    // Фильтруем только валидные peerId (не undefined и не пустые строки)
    const knownPeers = Array.from(this.peers.keys()).filter(peerId => 
        peerId && typeof peerId === 'string' && peerId.trim() !== '' && 
        peerId !== this.localPeerId // Исключаем собственный ID
    );
    
    if (knownPeers.length === 0) {
        console.log('Нет известных пиров для восстановления соединений');
        return;
    }
    
    console.log(`Попытка восстановления соединений с ${knownPeers.length} пирами...`);
    
    this.reconnectInProgress = true;
    this.reconnectStartTime = Date.now();
    
    // Показываем модальное окно через 1 секунду, если восстановление еще не завершено
    setTimeout(() => {
        if (this.reconnectInProgress && this.connectedPeers.size < knownPeers.length) {
            this.showReconnectModal();
        }
    }, 1000);
    
    // Пытаемся подключиться ко всем известным пирам параллельно
    const reconnectPromises = knownPeers.map(peerId => {
        if (!this.connectedPeers.has(peerId)) {
            return this.reconnectToPeer(peerId);
        }
        return Promise.resolve();
    });
    
    try {
        await Promise.allSettled(reconnectPromises);
    } catch (error) {
        console.error('Ошибка при восстановлении соединений:', error);
    }
    
    // Скрываем модальное окно после завершения
    this.reconnectInProgress = false;
    this.hideReconnectModal();
    
    const duration = Date.now() - this.reconnectStartTime;
    console.log(`Восстановление соединений завершено за ${duration}ms. Подключено: ${this.connectedPeers.size}/${knownPeers.length}`);
};

// Восстановление соединения с конкретным пиром
P2PClient.prototype.reconnectToPeer = async function(peerId) {
    // Проверяем валидность peerId
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '' || peerId === this.localPeerId) {
        console.error('Некорректный ID пира:', peerId);
        return;
    }
    
    const peerData = this.peers.get(peerId);
    if (!peerData) {
        console.error(`Данные пира ${peerId} не найдены`);
        return;
    }
    
    // Если уже подключены, пропускаем
    if (this.connectedPeers.has(peerId)) {
        console.log(`Пир ${peerId} уже подключен`);
        return;
    }
    
    // Проверяем количество попыток
    const attempts = this.reconnectAttempts.get(peerId) || 0;
    if (attempts >= this.maxReconnectAttempts) {
        console.log(`Превышено максимальное количество попыток подключения к пиру ${peerId}`);
        return;
    }
    
    this.reconnectAttempts.set(peerId, attempts + 1);
    
    try {
        console.log(`Попытка восстановления соединения с пиром ${peerId} (попытка ${attempts + 1})`);
        
        // Используем сохраненное предложение, если оно есть, иначе создаем новое
        if (peerData.lastOffer) {
            await this.reuseSavedOffer(peerId, peerData.lastOffer);
        } else {
            await this.createReconnectionOffer(peerId);
        }
        
        // Обновляем прогресс в модальном окне
        this.updateReconnectProgress();
        
    } catch (error) {
        console.error(`Ошибка восстановления соединения с пиром ${peerId}:`, error);
        
        // Если ошибка связана с SDP, очищаем сохраненное предложение и пробуем заново
        if (error.name === 'InvalidModificationError' || error.toString().includes('SDP')) {
            console.log(`Очистка устаревшего SDP для пира ${peerId}`);
            this.clearSavedOffer(peerId);
            
            // Пробуем создать новое предложение
            if (attempts + 1 < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.reconnectToPeer(peerId);
                }, this.reconnectTimeout);
            }
        } else {
            // Планируем следующую попытку, если не превышен лимит
            if (attempts + 1 < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.reconnectToPeer(peerId);
                }, this.reconnectTimeout);
            }
        }
    }
};

// Использование сохраненного предложения для восстановления
P2PClient.prototype.reuseSavedOffer = async function(peerId, savedOffer) {
    console.log(`Использование сохраненного предложения для пира ${peerId}`);
    
    // Закрываем существующее соединение, если оно есть
    if (this.connections.has(peerId)) {
        this.connections.get(peerId).close();
        this.connections.delete(peerId);
    }
    
    const connection = new RTCPeerConnection(this.rtcConfig);
    this.connections.set(peerId, connection);
    
    // Создаем канал данных
    const dataChannel = connection.createDataChannel('messenger', { 
        ordered: true,
        maxRetransmits: 30
    });
    this.setupDataChannel(dataChannel, peerId);
    
    // Обработчик входящего канала данных
    connection.ondatachannel = (event) => {
        const incomingChannel = event.channel;
        this.setupDataChannel(incomingChannel, peerId);
    };
    
    // Обработчики событий соединения
    this.setupConnectionHandlers(connection, peerId);
    
    try {
        // Устанавливаем сохраненное локальное описание
        await connection.setLocalDescription(savedOffer);
        console.log(`Сохраненное предложение установлено для пира ${peerId}`);
        
        // Создаем новое предложение для обновления ICE кандидатов
        const newOffer = await connection.createOffer();
        await connection.setLocalDescription(newOffer);
        
        // Сохраняем обновленное предложение
        this.savePeerOffer(peerId, newOffer);
        
    } catch (error) {
        console.error(`Ошибка использования сохраненного предложения для ${peerId}:`, error);
        throw error;
    }
};

// Создание предложения для повторного подключения
P2PClient.prototype.createReconnectionOffer = async function(peerId) {
    console.log(`Создание нового предложения для пира ${peerId}`);
    
    // Закрываем существующее соединение, если оно есть
    if (this.connections.has(peerId)) {
        this.connections.get(peerId).close();
        this.connections.delete(peerId);
    }
    
    const connection = new RTCPeerConnection(this.rtcConfig);
    this.connections.set(peerId, connection);
    
    // Создаем канал данных
    const dataChannel = connection.createDataChannel('messenger', { 
        ordered: true,
        maxRetransmits: 30
    });
    this.setupDataChannel(dataChannel, peerId);
    
    // Обработчик входящего канала данных
    connection.ondatachannel = (event) => {
        const incomingChannel = event.channel;
        this.setupDataChannel(incomingChannel, peerId);
    };
    
    // Обработчики событий соединения
    this.setupConnectionHandlers(connection, peerId);
    
    // Создаем предложение
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    
    // Сохраняем предложение для будущих попыток переподключения
    this.savePeerOffer(peerId, offer);
    
    console.log(`Создано предложение для повторного подключения к пиру ${peerId}`);
};

// Очистка сохраненного предложения для пира
P2PClient.prototype.clearSavedOffer = function(peerId) {
    const peerData = this.peers.get(peerId);
    if (peerData) {
        delete peerData.lastOffer;
        this.peers.set(peerId, peerData);
        
        // Сохраняем изменения в IndexedDB
        this.db.savePeer(peerData).catch(error => {
            console.error('Ошибка сохранения очищенного предложения:', error);
        });
    }
};

// Улучшенная обработка изменения состояния соединения
P2PClient.prototype.setupConnectionHandlers = function(connection, peerId) {
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
        const state = connection.connectionState;
        console.log(`Состояние соединения с ${peerId}: ${state}`);
        
        if (state === 'connected') {
            this.handlePeerConnected(peerId, connection);
        } else if (state === 'disconnected' || state === 'failed') {
            this.handlePeerDisconnected(peerId);
        } else if (state === 'closed') {
            this.handlePeerClosed(peerId);
        }
    };

    // Обработчик ICE соединения
    connection.oniceconnectionstatechange = () => {
        const iceState = connection.iceConnectionState;
        console.log(`ICE состояние соединения с ${peerId}: ${iceState}`);
        
        if (iceState === 'failed') {
            console.log(`ICE соединение с ${peerId} завершилось ошибкой`);
            this.handlePeerDisconnected(peerId);
        }
    };

    // Обработчик состояния сигнального канала
    connection.onsignalingstatechange = () => {
        console.log(`Сигнальное состояние с ${peerId}: ${connection.signalingState}`);
    };
};

// Обработчик подключения пира
P2PClient.prototype.handlePeerConnected = function(peerId, connection) {
    this.connectedPeers.add(peerId);
    this.isOnline = true;
    this.reconnectAttempts.set(peerId, 0); // Сбрасываем счетчик попыток
    
    console.log(`Пир ${peerId} успешно подключен`);
    
    // Сохраняем актуальное предложение
    if (connection.localDescription) {
        this.savePeerOffer(peerId, connection.localDescription);
    }
    
    this.updateUI();
    
    // Синхронизируем историю после подключения
    this.syncWithPeer(peerId);
};

// Обработчик отключения пира
P2PClient.prototype.handlePeerDisconnected = function(peerId) {
    this.connectedPeers.delete(peerId);
    
    if (this.connectedPeers.size === 0) {
        this.isOnline = false;
    }
    
    console.log(`Пир ${peerId} отключен`);
    this.updateUI();
    
    // Пытаемся переподключиться, если не в процессе массового восстановления
    if (!this.reconnectInProgress) {
        console.log(`Планируем переподключение к ${peerId} через ${this.reconnectTimeout}ms`);
        setTimeout(() => {
            this.reconnectToPeer(peerId);
        }, this.reconnectTimeout);
    }
};

// Обработчик закрытия соединения
P2PClient.prototype.handlePeerClosed = function(peerId) {
    console.log(`Соединение с ${peerId} закрыто`);
    
    // Очищаем ресурсы
    if (this.dataChannels.has(peerId)) {
        this.dataChannels.delete(peerId);
    }
    
    this.connectedPeers.delete(peerId);
    
    if (this.connectedPeers.size === 0) {
        this.isOnline = false;
    }
    
    this.updateUI();
};

// Проверка активности соединений
P2PClient.prototype.checkConnectionHealth = function() {
    this.connections.forEach((connection, peerId) => {
        if (connection.connectionState === 'connected') {
            // Проверяем канал данных
            const dataChannel = this.dataChannels.get(peerId);
            if (dataChannel && dataChannel.readyState === 'open') {
                // Отправляем ping-сообщение для проверки связи
                const pingMessage = {
                    type: 'ping',
                    sender: this.localPeerId,
                    timestamp: Date.now()
                };
                
                try {
                    dataChannel.send(JSON.stringify(pingMessage));
                } catch (error) {
                    console.error(`Ошибка отправки ping пиру ${peerId}:`, error);
                    this.handlePeerDisconnected(peerId);
                }
            }
        }
    });
};

// Обработка ping-сообщений
P2PClient.prototype.handlePingMessage = function(message, peerId) {
    // Отправляем pong в ответ
    const pongMessage = {
        type: 'pong',
        sender: this.localPeerId,
        timestamp: Date.now(),
        originalTimestamp: message.timestamp
    };
    
    this.sendToPeer(peerId, JSON.stringify(pongMessage));
};

// Обработка pong-сообщений
P2PClient.prototype.handlePongMessage = function(message, peerId) {
    const latency = Date.now() - message.originalTimestamp;
    console.log(`Ping с пиром ${peerId}: ${latency}ms`);
    
    // Обновляем время последней активности пира
    const peerData = this.peers.get(peerId);
    if (peerData) {
        peerData.lastSeen = Date.now();
        this.peers.set(peerId, peerData);
    }
};