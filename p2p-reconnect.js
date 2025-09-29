﻿// Функционал восстановления соединений
P2PClient.prototype.autoReconnectOnStart = async function() {
    // Фильтруем только валидные peerId (не undefined и не пустые строки)
    const knownPeers = Array.from(this.peers.keys()).filter(peerId => 
        peerId && typeof peerId === 'string' && peerId.trim() !== ''
    );
    
    if (knownPeers.length === 0) return;
    
    console.log(`Попытка восстановления соединений с ${knownPeers.length} пирами...`);
    
    this.reconnectInProgress = true;
    this.reconnectStartTime = Date.now();
    
    // Показываем модальное окно через 1 секунду, если восстановление еще не завершено
    setTimeout(() => {
        if (this.reconnectInProgress && this.connectedPeers.size < this.peers.size) {
            this.showReconnectModal();
        }
    }, 1000);
    
    // Пытаемся подключиться ко всем известным пирам
    for (const peerId of knownPeers) {
        if (!this.connectedPeers.has(peerId)) {
            await this.reconnectToPeer(peerId);
        }
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
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
        console.error('Некорректный ID пира:', peerId);
        return;
    }
    
    const peerData = this.peers.get(peerId);
    if (!peerData || this.connectedPeers.has(peerId)) return;
    
    // Проверяем количество попыток
    const attempts = this.reconnectAttempts.get(peerId) || 0;
    if (attempts >= this.maxReconnectAttempts) {
        console.log(`Превышено максимальное количество попыток подключения к пиру ${peerId}`);
        return;
    }
    
    this.reconnectAttempts.set(peerId, attempts + 1);
    
    try {
        console.log(`Попытка восстановления соединения с пиром ${peerId} (попытка ${attempts + 1})`);
        
        // Всегда создаем новое предложение вместо использования сохраненного
        await this.createReconnectionOffer(peerId);
        
        // Обновляем прогресс в модальном окне
        this.updateReconnectProgress();
        
    } catch (error) {
        console.error(`Ошибка восстановления соединения с пиром ${peerId}:`, error);
        
        // Если ошибка связана с SDP, очищаем сохраненное предложение
        if (error.name === 'InvalidModificationError' || error.toString().includes('SDP')) {
            console.log(`Очистка устаревшего SDP для пира ${peerId}`);
            this.clearSavedOffer(peerId);
        }
        
        // Планируем следующую попытку, если не превышен лимит
        if (attempts + 1 < this.maxReconnectAttempts) {
            setTimeout(() => {
                this.reconnectToPeer(peerId);
            }, this.reconnectTimeout);
        }
    }
};

// Создание предложения для повторного подключения
P2PClient.prototype.createReconnectionOffer = async function(peerId) {
    // Закрываем существующее соединение, если оно есть
    if (this.connections.has(peerId)) {
        this.connections.get(peerId).close();
        this.connections.delete(peerId);
    }
    
    const connection = new RTCPeerConnection(this.rtcConfig);
    this.connections.set(peerId, connection);
    
    // Создаем канал данных
    const dataChannel = connection.createDataChannel('messenger', { ordered: true });
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
        this.saveToStorage();
    }
};
