﻿// Функционал управления соединениями WebRTC
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

// Обработка входящего предложения - улучшаем для работы с восстановлением
P2PClient.prototype.handleOffer = async function(signalData) {
    try {
        const peerId = signalData.peerId;
        
        // Проверяем валидность ID пира
        if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
            this.showMessageModal('Ошибка', 'Некорректный ID пира в предложении');
            return;
        }

        // Если это переподключение существующего пира, закрываем старое соединение
        if (this.connections.has(peerId)) {
            const oldConnection = this.connections.get(peerId);
            if (oldConnection.connectionState !== 'connected') {
                console.log(`Закрываем старое соединение с ${peerId} для переподключения`);
                oldConnection.close();
                this.connections.delete(peerId);
            } else {
                console.log(`Пир ${peerId} уже подключен, игнорируем новое предложение`);
                return;
            }
        }
        
        // Создаем соединение
        const connection = new RTCPeerConnection(this.rtcConfig);
        this.connections.set(peerId, connection);
        
        // Обновляем или добавляем пира в список
        let peerData = this.peers.get(peerId);
        if (!peerData) {
            peerData = {
                id: peerId,
                lastSeen: Date.now(),
                connectionCount: 1
            };
            this.peers.set(peerId, peerData);
        } else {
            peerData.lastSeen = Date.now();
            peerData.connectionCount = (peerData.connectionCount || 0) + 1;
        }

        // Сохраняем обновленные данные пира
        await this.db.savePeer(peerData);
        
        // Обработчик входящего канала данных
        connection.ondatachannel = (event) => {
            const incomingChannel = event.channel;
            this.setupDataChannel(incomingChannel, peerId);
        };
        
        // Обработчики событий соединения
        this.setupConnectionHandlers(connection, peerId);
        
        // Устанавливаем удаленное предложение
        await connection.setRemoteDescription(signalData.offer);
        
        // Создаем ответ
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        
        // Сохраняем ответ для будущих переподключений
        this.savePeerOffer(peerId, answer);
        
        // Формируем сигнальные данные для ответа
        const answerSignalData = {
            type: 'answer',
            peerId: this.localPeerId,
            targetPeerId: peerId,
            answer: answer
        };
        
        // Кодируем в Base64
        const jsonStr = JSON.stringify(answerSignalData);
        const base64Data = this.encodeBase64(jsonStr);
        
        // Показываем ответ для копирования
        document.getElementById('localOfferData').value = base64Data;
        document.getElementById('copyOfferBtn').disabled = false;
        
        console.log('Ответ создан, отправьте его инициатору подключения');
        this.showMessageModal('Успех', 'Ответ создан. Скопируйте его и отправьте обратно инициатору подключения.');
        
        this.updateUI();
        
    } catch (error) {
        console.error('Ошибка обработки предложения:', error);
        this.showMessageModal('Ошибка', 'Ошибка обработки предложения: ' + error.message);
    }
};

// Обработка входящего ответа - улучшаем для работы с восстановлением
P2PClient.prototype.handleAnswer = async function(signalData) {
    try {
        const peerId = signalData.peerId;
        
        // Проверяем валидность ID пира
        if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
            this.showMessageModal('Ошибка', 'Некорректный ID пира в ответе');
            return;
        }

        // Ищем ожидающее предложение или существующее соединение
        let connection;
        if (this.pendingOffer && this.pendingOffer.peerId) {
            connection = this.pendingOffer.connection;
        } else {
            connection = this.connections.get(peerId);
        }

        if (!connection) {
            this.showMessageModal('Ошибка', 'Нет активного соединения для этого ответа');
            return;
        }
        
        // Обновляем или добавляем пира в список
        let peerData = this.peers.get(peerId);
        if (!peerData) {
            peerData = {
                id: peerId,
                lastSeen: Date.now(),
                connectionCount: 1
            };
        } else {
            peerData.lastSeen = Date.now();
            peerData.connectionCount = (peerData.connectionCount || 0) + 1;
        }
        
        this.peers.set(peerId, peerData);
        await this.db.savePeer(peerData);
        
        // Обновляем ID пира на реальный если это был временный ID
        if (this.pendingOffer && this.pendingOffer.peerId !== peerId) {
            this.connections.delete(this.pendingOffer.peerId);
            this.connections.set(peerId, connection);
        }
        
        // Устанавливаем удаленный ответ
        await connection.setRemoteDescription(signalData.answer);
        
        // Сохраняем предложение для будущих переподключений
        if (connection.localDescription) {
            this.savePeerOffer(peerId, connection.localDescription);
        }
        
        this.pendingOffer = null;
        
        console.log(`Ответ установлен, соединение с ${peerId} должно установиться`);
        
        this.updateUI();
        
    } catch (error) {
        console.error('Ошибка обработки ответа:', error);
        this.showMessageModal('Ошибка', 'Ошибка обработки ответа: ' + error.message);
    }
};

// Создание предложения для подключения
P2PClient.prototype.createOffer = async function() {
    // Показываем модальное окно создания предложения
    this.showCreatingOfferModal();
    
    try {
        // Создаем временный ID для нового пира
        const newPeerId = 'peer_' + Math.random().toString(36).substr(2, 9);
        
        // Создаем соединение с улучшенными настройками
        const connection = new RTCPeerConnection(this.rtcConfig);
        this.connections.set(newPeerId, connection);
        
        // Создаем канал данных с улучшенными настройками
        const dataChannel = connection.createDataChannel('messenger', {
            ordered: true,
            maxRetransmits: 30, // Увеличиваем количество попыток ретрансмиссии
            protocol: 'messenger-protocol'
        });
        this.setupDataChannel(dataChannel, newPeerId);
        
        // Обработчик входящего канала данных
        connection.ondatachannel = (event) => {
            const incomingChannel = event.channel;
            this.setupDataChannel(incomingChannel, newPeerId);
        };
        
        // Обработчик ICE кандидатов
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Новый ICE кандидат:', event.candidate);
            } else {
                console.log('Все ICE кандидаты собраны');
                this.updateOfferDisplay(newPeerId);
            }
        };
        
        // Обработчик изменения состояния соединения
        connection.onconnectionstatechange = () => {
            console.log(`Состояние соединения: ${connection.connectionState}`);
            
            if (connection.connectionState === 'connected') {
                // Обновляем ID пира на реальный после установки соединения
                this.finalizePeerConnection(newPeerId);
                this.connectedPeers.add(newPeerId);
                this.isOnline = true;
                this.updateUI();
                
                // Синхронизируем историю после подключения
                this.syncWithPeer(newPeerId);
            } else if (connection.connectionState === 'disconnected' || 
                      connection.connectionState === 'failed') {
                this.connectedPeers.delete(newPeerId);
                if (this.connectedPeers.size === 0) {
                    this.isOnline = false;
                }
                this.updateUI();
                
                // Пытаемся переподключиться
                if (!this.reconnectInProgress) {
                    setTimeout(() => {
                        this.reconnectToPeer(newPeerId);
                    }, this.reconnectTimeout);
                }
            }
        };

        // Обработчик ICE соединения
        connection.oniceconnectionstatechange = () => {
            console.log(`ICE состояние соединения: ${connection.iceConnectionState}`);
            
            if (connection.iceConnectionState === 'failed') {
                console.log('ICE соединение завершилось ошибкой, пытаемся восстановить...');
                if (!this.reconnectInProgress) {
                    setTimeout(() => {
                        this.reconnectToPeer(newPeerId);
                    }, this.reconnectTimeout);
                }
            }
        };
        
        // Создаем предложение
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        
        this.pendingOffer = {
            peerId: newPeerId,
            connection: connection
        };
        
        console.log('Предложение создано, ожидаем ICE кандидатов...');
        
    } catch (error) {
        console.error('Ошибка создания предложения:', error);
        this.showMessageModal('Ошибка', 'Ошибка создания предложения: ' + error.message);
        this.hideCreatingOfferModal();
    }
};

// Обработка входящего предложения
P2PClient.prototype.handleOffer = async function(signalData) {
    try {
        const peerId = signalData.peerId;
        
        // Проверяем валидность ID пира
        if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
            this.showMessageModal('Ошибка', 'Некорректный ID пира в предложении');
            return;
        }
        
        if (this.peers.has(peerId)) {
            this.showMessageModal('Ошибка', 'Этот пир уже подключен');
            return;
        }
        
        // Создаем соединение с улучшенными настройками
        const connection = new RTCPeerConnection(this.rtcConfig);
        this.connections.set(peerId, connection);
        
        // Добавляем пира в список
        this.peers.set(peerId, {
            id: peerId,
            lastSeen: Date.now(),
            connectionCount: 1
        });
        
        // Обработчик входящего канала данных
        connection.ondatachannel = (event) => {
            const incomingChannel = event.channel;
            this.setupDataChannel(incomingChannel, peerId);
        };
        
        // Обработчик ICE кандидатов
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Новый ICE кандидат для ${peerId}:`, event.candidate);
            }
        };
        
        // Обработчик изменения состояния соединения
        connection.onconnectionstatechange = () => {
            console.log(`Состояние соединения с ${peerId}: ${connection.connectionState}`);
            
            if (connection.connectionState === 'connected') {
                this.connectedPeers.add(peerId);
                this.isOnline = true;
                this.updateUI();
                
                // Сохраняем ответ для будущих переподключений
                if (connection.localDescription) {
                    const peerData = this.peers.get(peerId);
                    if (peerData) {
                        peerData.lastAnswer = connection.localDescription;
                        this.saveToStorage();
                    }
                }
                
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
                if (!this.reconnectInProgress) {
                    setTimeout(() => {
                        this.reconnectToPeer(peerId);
                    }, this.reconnectTimeout);
                }
            }
        };
        
        // Устанавливаем удаленное предложение
        await connection.setRemoteDescription(signalData.offer);
        
        // Создаем ответ
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        
        // Формируем сигнальные данные для ответа
        const answerSignalData = {
            type: 'answer',
            peerId: this.localPeerId,
            targetPeerId: peerId,
            answer: answer
        };
        
        // Кодируем в Base64
        const jsonStr = JSON.stringify(answerSignalData);
        const base64Data = this.encodeBase64(jsonStr);
        
        // Показываем ответ для копирования
        document.getElementById('localOfferData').value = base64Data;
        document.getElementById('copyOfferBtn').disabled = false;
        
        console.log('Ответ создан, отправьте его инициатору подключения');
        this.showMessageModal('Успех', 'Ответ создан. Скопируйте его и отправьте обратно инициатору подключения.');
        
        this.updateUI();
        
    } catch (error) {
        console.error('Ошибка обработки предложения:', error);
        this.showMessageModal('Ошибка', 'Ошибка обработки предложения: ' + error.message);
    }
};

// Обработка входящего ответа
P2PClient.prototype.handleAnswer = async function(signalData) {
    try {
        if (!this.pendingOffer) {
            this.showMessageModal('Ошибка', 'Нет ожидающих предложений');
            return;
        }
        
        const peerId = signalData.peerId;
        
        // Проверяем валидность ID пира
        if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
            this.showMessageModal('Ошибка', 'Некорректный ID пира в ответе');
            return;
        }
        
        const connection = this.pendingOffer.connection;
        
        // Добавляем пира в список
        this.peers.set(peerId, {
            id: peerId,
            lastSeen: Date.now(),
            connectionCount: 1
        });
        
        // Обновляем ID пира на реальный
        this.connections.delete(this.pendingOffer.peerId);
        this.connections.set(peerId, connection);
        
        // Устанавливаем удаленный ответ
        await connection.setRemoteDescription(signalData.answer);
        
        // Сохраняем предложение для будущих переподключений
        if (connection.localDescription) {
            this.savePeerOffer(peerId, connection.localDescription);
        }
        
        this.pendingOffer = null;
        
        console.log(`Ответ установлен, соединение с ${peerId} должно установиться`);
        
        this.updateUI();
        
    } catch (error) {
        console.error('Ошибка обработки ответа:', error);
        this.showMessageModal('Ошибка', 'Ошибка обработки ответа: ' + error.message);
    }
};

// Финализация подключения к пиру
P2PClient.prototype.finalizePeerConnection = function(temporaryPeerId) {
    // Проверяем валидность ID пира
    if (!temporaryPeerId || typeof temporaryPeerId !== 'string' || temporaryPeerId.trim() === '') {
        console.error('Некорректный ID пира для финализации:', temporaryPeerId);
        return;
    }
    
    console.log(`Подключение к пиру ${temporaryPeerId} установлено`);
    
    // Сохраняем пира
    if (!this.peers.has(temporaryPeerId)) {
        this.peers.set(temporaryPeerId, {
            id: temporaryPeerId,
            lastSeen: Date.now(),
            connectionCount: 1
        });
    }
    
    // Сохраняем предложение для будущих переподключений
    const connection = this.connections.get(temporaryPeerId);
    if (connection && connection.localDescription) {
        this.savePeerOffer(temporaryPeerId, connection.localDescription);
    }
};

// Обработка входящих сигнальных данных
P2PClient.prototype.processSignalData = async function() {
    const signalInput = document.getElementById('remoteSignalInput');
    const signalDataStr = signalInput.value.trim();
    
    if (!signalDataStr) {
        this.showMessageModal('Ошибка', 'Введите сигнальные данные');
        return;
    }
    
    try {
        // Пытаемся декодировать из Base64
        let decodedData;
        try {
            decodedData = this.decodeBase64(signalDataStr);
        } catch (e) {
            // Если не Base64, используем как есть
            decodedData = signalDataStr;
        }
        
        const signalData = JSON.parse(decodedData);
        
        if (signalData.type === 'offer') {
            await this.handleOffer(signalData);
        } else if (signalData.type === 'answer') {
            await this.handleAnswer(signalData);
        } else {
            this.showMessageModal('Ошибка', 'Неизвестный тип сигнальных данных');
        }
        
        signalInput.value = '';
        
    } catch (error) {
        console.error('Ошибка обработки сигнальных данных:', error);
        this.showMessageModal('Ошибка', 'Некорректные сигнальные данные: ' + error.message);
    }
};