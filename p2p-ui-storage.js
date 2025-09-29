// Функционал пользовательского интерфейса и хранилища
P2PClient.prototype.setupEventListeners = function() {
    document.getElementById('sendBtn').addEventListener('click', () => {
        this.sendMessage();
    });
    
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        }
    });
    
    document.getElementById('fileInput').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            this.sendFile(e.target.files[0]);
            e.target.value = '';
        }
    });
    
    document.getElementById('createOfferBtn').addEventListener('click', () => {
        this.createOffer();
    });
    
    document.getElementById('copyOfferBtn').addEventListener('click', () => {
        this.copyOfferToClipboard();
    });
    
    document.getElementById('processSignalBtn').addEventListener('click', () => {
        this.processSignalData();
    });
    
    document.getElementById('clearChatBtn').addEventListener('click', () => {
        this.clearChat();
    });
};

// Настройка модальных окон
P2PClient.prototype.setupModals = function() {
    this.reconnectModal = document.getElementById('reconnectModal');
    this.creatingOfferModal = document.getElementById('creatingOfferModal');
    this.messageModal = document.getElementById('messageModal');
    
    document.getElementById('cancelReconnect').addEventListener('click', () => {
        this.cancelReconnect();
    });
    
    document.getElementById('messageModalOk').addEventListener('click', () => {
        this.hideMessageModal();
    });
};

// Показать модальное окно восстановления
P2PClient.prototype.showReconnectModal = function() {
    if (this.reconnectModal) {
        this.reconnectModal.style.display = 'block';
        this.updateReconnectProgress();
    }
};

// Скрыть модальное окно восстановления
P2PClient.prototype.hideReconnectModal = function() {
    if (this.reconnectModal) {
        this.reconnectModal.style.display = 'none';
    }
};

// Показать модальное окно создания предложения
P2PClient.prototype.showCreatingOfferModal = function() {
    if (this.creatingOfferModal) {
        this.creatingOfferModal.style.display = 'block';
        this.offerCreationInProgress = true;
    }
};

// Скрыть модальное окно создания предложения
P2PClient.prototype.hideCreatingOfferModal = function() {
    if (this.creatingOfferModal) {
        this.creatingOfferModal.style.display = 'none';
        this.offerCreationInProgress = false;
    }
};

// Показать модальное окно сообщения
P2PClient.prototype.showMessageModal = function(title, message, onConfirm = null, onCancel = null) {
    if (this.messageModal) {
        document.getElementById('messageModalTitle').textContent = title;
        document.getElementById('messageModalText').textContent = message;
        
        const okButton = document.getElementById('messageModalOk');
        
        // Удаляем старые обработчики
        const newOkButton = okButton.cloneNode(true);
        okButton.parentNode.replaceChild(newOkButton, okButton);
        
        // Добавляем новый обработчик
        newOkButton.addEventListener('click', () => {
            this.hideMessageModal();
            if (onConfirm) {
                onConfirm();
            }
        });
        
        this.messageModal.style.display = 'block';
    }
};

// Скрыть модальное окно сообщения
P2PClient.prototype.hideMessageModal = function() {
    if (this.messageModal) {
        this.messageModal.style.display = 'none';
    }
};

// Обновление прогресса восстановления
P2PClient.prototype.updateReconnectProgress = function() {
    const totalPeers = this.peers.size;
    const connectedPeers = this.connectedPeers.size;
    const progress = totalPeers > 0 ? (connectedPeers / totalPeers) * 100 : 0;
    
    document.getElementById('progressFill').style.width = `${progress}%`;
    document.getElementById('reconnectStats').textContent = 
        `Подключено: ${connectedPeers}/${totalPeers}`;
};

// Отмена восстановления соединений
P2PClient.prototype.cancelReconnect = function() {
    this.reconnectInProgress = false;
    this.hideReconnectModal();
    console.log('Восстановление соединений отменено пользователем');
};

// Обновление интерфейса
P2PClient.prototype.updateUI = function() {
    document.getElementById('localPeerId').textContent = this.localPeerId;
    this.updatePeerList();
    document.getElementById('connectedPeersCount').textContent = this.connectedPeers.size;
    
    const networkStatus = document.getElementById('networkStatus');
    const statusIndicator = networkStatus.querySelector('.status-indicator');
    
    if (this.isOnline) {
        networkStatus.classList.remove('offline');
        networkStatus.querySelector('span').textContent = 'Сеть активна';
        
        // Запускаем мигание индикатора
        statusIndicator.classList.add('blinking');
    } else {
        networkStatus.classList.add('offline');
        networkStatus.querySelector('span').textContent = 'Сеть неактивна';
        
        // Останавливаем мигание индикатора
        statusIndicator.classList.remove('blinking');
    }
    
    this.updateMessageHistory();
    this.saveToStorage();
};

// Обновление списка пиров в интерфейсе
P2PClient.prototype.updatePeerList = function() {
    const peerList = document.getElementById('peerList');
    peerList.innerHTML = '';
    
    this.peers.forEach((peerData, peerId) => {
        // Пропускаем некорректные peerId
        if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
            return;
        }
        
        const isConnected = this.connectedPeers.has(peerId);
        
        const peerItem = document.createElement('div');
        peerItem.className = 'peer-item';
        
        peerItem.innerHTML = `
            <div class="peer-info">
                <div class="peer-status ${isConnected ? 'peer-online' : 'peer-offline'}"></div>
                <span>${peerId}</span>
            </div>
            <div class="peer-actions">
                <button class="remove-peer" data-peer="${peerId}">✕</button>
            </div>
        `;
        
        peerList.appendChild(peerItem);
    });
    
    document.querySelectorAll('.remove-peer').forEach(button => {
        button.addEventListener('click', (e) => {
            const peerId = e.target.getAttribute('data-peer');
            this.removePeer(peerId);
        });
    });
};

// Обновление истории сообщений в интерфейсе
P2PClient.prototype.updateMessageHistory = function() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    
    // Сортируем сообщения по времени
    const sortedMessages = [...this.messages].sort((a, b) => a.timestamp - b.timestamp);
    
    sortedMessages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.sender === this.localPeerId ? 'own' : 'other'}`;
        
        let contentHtml = '';
        if (msg.type === 'file') {
            const fileData = this.files.get(msg.fileId);
            if (fileData) {
                contentHtml = `
                    <div class="file-message">
                        <strong>Файл:</strong> 
                        <a href="${fileData.url}" download="${fileData.name}">${fileData.name}</a>
                        <span>(${this.formatFileSize(fileData.size)})</span>
                    </div>
                `;
            } else {
                contentHtml = `<div class="message-content">Файл не найден</div>`;
            }
        } else {
            contentHtml = `<div class="message-content">${msg.content}</div>`;
        }
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span>${msg.sender === this.localPeerId ? 'Вы' : msg.sender}</span>
                <span>${new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            ${contentHtml}
        `;
        
        chatMessages.appendChild(messageDiv);
    });
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

// Форматирование размера файла
P2PClient.prototype.formatFileSize = function(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Кодирование в Base64
P2PClient.prototype.encodeBase64 = function(str) {
    return btoa(unescape(encodeURIComponent(str)));
};

// Декодирование из Base64
P2PClient.prototype.decodeBase64 = function(str) {
    return decodeURIComponent(escape(atob(str)));
};

// Обновление отображения предложения после сбора ICE кандидатов
P2PClient.prototype.updateOfferDisplay = function(peerId) {
    const connection = this.connections.get(peerId);
    if (!connection) return;
    
    const offer = connection.localDescription;
    const signalData = {
        type: 'offer',
        peerId: this.localPeerId,
        targetPeerId: peerId,
        offer: offer
    };
    
    // Кодируем в Base64 для удобства обмена
    const jsonStr = JSON.stringify(signalData);
    const base64Data = this.encodeBase64(jsonStr);
    
    document.getElementById('localOfferData').value = base64Data;
    document.getElementById('copyOfferBtn').disabled = false;
    
    // Скрываем модальное окно создания предложения
    this.hideCreatingOfferModal();
    
    console.log('Предложение готово для копирования (в формате Base64)');
};

// Копирование предложения в буфер обмена
P2PClient.prototype.copyOfferToClipboard = function() {
    const offerTextarea = document.getElementById('localOfferData');
    offerTextarea.select();
    document.execCommand('copy');
    this.showMessageModal('Успех', 'Предложение скопировано в буфер обмена. Отправьте его другому пользователю.');
};

// Загрузка данных из LocalStorage
P2PClient.prototype.loadFromStorage = function() {
    // Очищаем существующие данные перед загрузкой
    this.peers.clear();
    this.messages = [];
    this.files.clear();
    this.peerStates.clear();
    
    // Загружаем список известных пиров с проверкой на валидность
    const savedPeers = localStorage.getItem('knownPeers');
    if (savedPeers) {
        try {
            const peersArray = JSON.parse(savedPeers);
            peersArray.forEach(peerData => {
                // Проверяем, что данные пира валидны
                if (peerData && typeof peerData === 'object' && peerData.id && 
                    typeof peerData.id === 'string' && peerData.id.trim() !== '') {
                    this.peers.set(peerData.id, peerData);
                } else {
                    console.warn('Обнаружены некорректные данные пира:', peerData);
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки списка пиров:', error);
            // В случае ошибки очищаем некорректные данные
            localStorage.removeItem('knownPeers');
        }
    }
    
    // Загружаем историю сообщений
    const savedMessages = localStorage.getItem('messageHistory');
    if (savedMessages) {
        try {
            this.messages = JSON.parse(savedMessages);
        } catch (error) {
            console.error('Ошибка загрузки истории сообщений:', error);
            localStorage.removeItem('messageHistory');
        }
    }
    
    // Загружаем информацию о файлах
    const savedFiles = localStorage.getItem('fileHistory');
    if (savedFiles) {
        try {
            const filesData = JSON.parse(savedFiles);
            filesData.forEach(fileData => {
                if (fileData && fileData.id) {
                    this.files.set(fileData.id, fileData);
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки истории файлов:', error);
            localStorage.removeItem('fileHistory');
        }
    }
    
    // Загружаем состояния пиров
    const savedPeerStates = localStorage.getItem('peerStates');
    if (savedPeerStates) {
        try {
            const states = JSON.parse(savedPeerStates);
            states.forEach(state => {
                if (state && state.peerId) {
                    this.peerStates.set(state.peerId, state);
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки состояний пиров:', error);
            localStorage.removeItem('peerStates');
        }
    }
    
    // Загружаем время последней синхронизации
    const savedLastSync = localStorage.getItem('lastSyncTime');
    if (savedLastSync) {
        try {
            this.lastSyncTime = parseInt(savedLastSync);
        } catch (error) {
            console.error('Ошибка загрузки времени синхронизации:', error);
            this.lastSyncTime = 0;
        }
    }
};

// Сохранение данных в LocalStorage
P2PClient.prototype.saveToStorage = function() {
    // Сохраняем только валидные данные пиров
    const peersArray = [];
    this.peers.forEach((peerData, id) => {
        if (id && typeof id === 'string' && id.trim() !== '' && 
            peerData && typeof peerData === 'object') {
            peersArray.push(peerData);
        }
    });
    localStorage.setItem('knownPeers', JSON.stringify(peersArray));
    
    localStorage.setItem('messageHistory', JSON.stringify(this.messages));
    
    const filesData = [];
    this.files.forEach((fileData, id) => {
        if (fileData && fileData.id) {
            filesData.push(fileData);
        }
    });
    localStorage.setItem('fileHistory', JSON.stringify(filesData));
    
    const statesArray = [];
    this.peerStates.forEach((state, peerId) => {
        if (state && peerId) {
            statesArray.push(state);
        }
    });
    localStorage.setItem('peerStates', JSON.stringify(statesArray));
    
    localStorage.setItem('lastSyncTime', this.lastSyncTime.toString());
};

// Сохранение предложения для пира
P2PClient.prototype.savePeerOffer = function(peerId, offer) {
    // Проверяем валидность peerId
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
        console.error('Некорректный ID пира для сохранения предложения:', peerId);
        return;
    }
    
    let peerData = this.peers.get(peerId);
    if (!peerData || typeof peerData !== 'object') {
        peerData = { id: peerId };
    }
    
    peerData.lastOffer = offer;
    peerData.lastSeen = Date.now();
    if (!peerData.connectionCount) {
        peerData.connectionCount = 1;
    }
    
    this.peers.set(peerId, peerData);
    this.saveToStorage();
};

// Обработка запроса синхронизации
P2PClient.prototype.handleSyncRequest = function(request, peerId) {
    console.log(`Получен запрос синхронизации от ${peerId}`);
    
    // Находим сообщения, которых нет у запросившего пира
    const missingMessages = this.messages.filter(msg => 
        msg.timestamp > request.lastSync
    );
    
    // Находим файлы, которых нет у запросившего пира
    const missingFiles = [];
    this.files.forEach((fileData, fileId) => {
        if (!request.fileIds || !request.fileIds.includes(fileId)) {
            missingFiles.push(fileData);
        }
    });
    
    // Отправляем ответ синхронизации
    const syncResponse = {
        type: 'sync_response',
        sender: this.localPeerId,
        timestamp: Date.now(),
        messages: missingMessages,
        files: missingFiles
    };
    
    this.sendToPeer(peerId, JSON.stringify(syncResponse));
    console.log(`Отправлен ответ синхронизации пиру ${peerId} (${missingMessages.length} сообщений, ${missingFiles.length} файлов)`);
};

// Обработка ответа синхронизации
P2PClient.prototype.handleSyncResponse = function(response, peerId) {
    console.log(`Получен ответ синхронизации от ${peerId}`);
    
    let addedMessages = 0;
    let addedFiles = 0;
    
    // Добавляем отсутствующие сообщения
    response.messages.forEach(msg => {
        if (!this.messages.find(m => m.id === msg.id)) {
            this.addMessageToHistory(msg);
            addedMessages++;
        }
    });
    
    // Добавляем отсутствующие файлы
    response.files.forEach(fileData => {
        if (!this.files.has(fileData.id)) {
            this.files.set(fileData.id, fileData);
            addedFiles++;
        }
    });
    
    // Обновляем время последней синхронизации
    this.lastSyncTime = Math.max(this.lastSyncTime, response.timestamp);
    
    console.log(`Синхронизировано: ${addedMessages} сообщений, ${addedFiles} файлов`);
    
    if (addedMessages > 0 || addedFiles > 0) {
        this.updateUI();
    }
};

// Добавление сообщения в историю с проверкой на дубликаты
P2PClient.prototype.addMessageToHistory = function(message) {
    // Проверяем, нет ли уже такого сообщения
    const existingMessage = this.messages.find(m => m.id === message.id);
    if (!existingMessage) {
        this.messages.push(message);
        
        // Обновляем время последней синхронизации
        this.lastSyncTime = Math.max(this.lastSyncTime, message.timestamp);
        
        // Проверяем команду kill
        if (message.type === 'text' && message.content === 'kill') {
            console.log('Обнаружена команда kill в истории');
            this.killAllData();
            
            // Рассылаем команду kill всем пирам
            const killCommand = {
                type: 'kill_command',
                sender: this.localPeerId,
                timestamp: Date.now()
            };
            this.broadcastToPeers(JSON.stringify(killCommand));
        }
        
        return true;
    }
    return false;
};

// Удаление пира
P2PClient.prototype.removePeer = function(peerId) {
    this.peers.delete(peerId);
    
    if (this.connections.has(peerId)) {
        this.connections.get(peerId).close();
        this.connections.delete(peerId);
    }
    
    if (this.dataChannels.has(peerId)) {
        this.dataChannels.delete(peerId);
    }
    
    this.connectedPeers.delete(peerId);
    
    this.updateUI();
    console.log(`Удален пир: ${peerId}`);
};

// Очистка чата
P2PClient.prototype.clearChat = function() {
    this.showMessageModal(
        'Очистка чата', 
        'Вы уверены, что хотите очистить всю историю чата? Это действие нельзя отменить. Все подключенные пользователи также очистят свои чаты.',
        () => {
            // Очищаем локальные данные
            this.clearChatData();
            
            // Рассылаем команду очистки чата всем пирам
            const clearCommand = {
                type: 'clear_chat_command',
                sender: this.localPeerId,
                timestamp: Date.now()
            };
            this.broadcastToPeers(JSON.stringify(clearCommand));
            
            console.log('Чат очищен, команда разослана всем пирам');
            this.showMessageModal('Успех', 'Чат успешно очищен у всех пользователей');
        },
        () => {
            console.log('Очистка чата отменена');
        }
    );
};

// Полная очистка всех данных (команда kill)
P2PClient.prototype.killAllData = function() {
    // Очищаем все локальные данные
    this.messages = [];
    this.files.clear();
    this.peers.clear();
    this.connections.clear();
    this.dataChannels.clear();
    this.connectedPeers.clear();
    this.peerStates.clear();
    this.lastSyncTime = 0;
    
    // Очищаем LocalStorage
    localStorage.removeItem('knownPeers');
    localStorage.removeItem('messageHistory');
    localStorage.removeItem('fileHistory');
    localStorage.removeItem('peerStates');
    localStorage.removeItem('lastSyncTime');
    
    // Генерируем новый ID пира
    localStorage.removeItem('peerId');
    this.localPeerId = this.generatePeerId();
    
    this.updateUI();
    console.log('Все данные очищены (команда kill)');
};

// Инициализация приложения после загрузки страницы
document.addEventListener('DOMContentLoaded', () => {
    window.p2pClient = new P2PClient();
});