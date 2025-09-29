// Основной класс P2P клиента
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
        this.maxReconnectAttempts = 3;
        this.reconnectTimeout = 5000; // 5 секунд между попытками
        
        // Для модального окна восстановления
        this.reconnectModal = null;
        this.reconnectInProgress = false;
        this.reconnectStartTime = 0;
        
        this.init();
    }
    
    // Инициализация приложения
    init() {
        this.loadFromStorage();
        this.setupEventListeners();
        this.setupModal();
        this.updateUI();
        this.startPeerMonitoring();
        
        // Автоматическое восстановление соединений при старте
        this.autoReconnectOnStart();
        
        console.log(`P2P клиент инициализирован с ID: ${this.localPeerId}`);
    }
    
    // Настройка модального окна
    setupModal() {
        this.reconnectModal = document.getElementById('reconnectModal');
        document.getElementById('cancelReconnect').addEventListener('click', () => {
            this.cancelReconnect();
        });
    }
    
    // Показать модальное окно восстановления
    showReconnectModal() {
        if (this.reconnectModal) {
            this.reconnectModal.style.display = 'block';
            this.updateReconnectProgress();
        }
    }
    
    // Скрыть модальное окно восстановления
    hideReconnectModal() {
        if (this.reconnectModal) {
            this.reconnectModal.style.display = 'none';
        }
    }
    
    // Обновление прогресса восстановления
    updateReconnectProgress() {
        const totalPeers = this.peers.size;
        const connectedPeers = this.connectedPeers.size;
        const progress = totalPeers > 0 ? (connectedPeers / totalPeers) * 100 : 0;
        
        document.getElementById('progressFill').style.width = `${progress}%`;
        document.getElementById('reconnectStats').textContent = 
            `Подключено: ${connectedPeers}/${totalPeers}`;
    }
    
    // Отмена восстановления соединений
    cancelReconnect() {
        this.reconnectInProgress = false;
        this.hideReconnectModal();
        console.log('Восстановление соединений отменено пользователем');
    }
    
    // Автоматическое восстановление соединений при старте
    async autoReconnectOnStart() {
        const knownPeers = Array.from(this.peers.keys());
        if (knownPeers.length === 0) return;
        
        console.log(`Попытка восстановления соединений с ${knownPeers.length} пирами...`);
        
        this.reconnectInProgress = true;
        this.reconnectStartTime = Date.now();
        
        // Показываем модальное окно через 2 секунды, если восстановление еще не завершено
        setTimeout(() => {
            if (this.reconnectInProgress && this.connectedPeers.size < this.peers.size) {
                this.showReconnectModal();
            }
        }, 2000);
        
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
    }
    
    // Восстановление соединения с конкретным пиром
    async reconnectToPeer(peerId) {
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
            
            // Если есть сохраненные сигнальные данные, используем их
            if (peerData.lastOffer) {
                await this.connectWithSavedOffer(peerId, peerData.lastOffer);
            } else {
                // Иначе создаем новое предложение
                await this.createReconnectionOffer(peerId);
            }
            
            // Обновляем прогресс в модальном окне
            this.updateReconnectProgress();
            
        } catch (error) {
            console.error(`Ошибка восстановления соединения с пиром ${peerId}:`, error);
            
            // Планируем следующую попытку, если не превышен лимит
            if (attempts + 1 < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.reconnectToPeer(peerId);
                }, this.reconnectTimeout);
            }
        }
    }
    
    // Создание предложения для повторного подключения
    async createReconnectionOffer(peerId) {
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
    }
    
    // Подключение с использованием сохраненного предложения
    async connectWithSavedOffer(peerId, savedOffer) {
        const connection = new RTCPeerConnection(this.rtcConfig);
        this.connections.set(peerId, connection);
        
        // Обработчик входящего канала данных
        connection.ondatachannel = (event) => {
            const incomingChannel = event.channel;
            this.setupDataChannel(incomingChannel, peerId);
        };
        
        // Обработчики событий соединения
        this.setupConnectionHandlers(connection, peerId);
        
        // Создаем канал данных
        const dataChannel = connection.createDataChannel('messenger', { ordered: true });
        this.setupDataChannel(dataChannel, peerId);
        
        // Используем сохраненное предложение
        await connection.setLocalDescription(savedOffer);
        
        console.log(`Использовано сохраненное предложение для подключения к пиру ${peerId}`);
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
    
    // Генерация уникального ID для пира
    generatePeerId() {
        const savedId = localStorage.getItem('peerId');
        if (savedId) return savedId;
        
        const newId = 'peer_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('peerId', newId);
        return newId;
    }
    
    // Загрузка данных из LocalStorage
    loadFromStorage() {
        const savedPeers = localStorage.getItem('knownPeers');
        if (savedPeers) {
            const peersArray = JSON.parse(savedPeers);
            peersArray.forEach(peerData => {
                this.peers.set(peerData.id, peerData);
            });
        }
        
        const savedMessages = localStorage.getItem('messageHistory');
        if (savedMessages) {
            this.messages = JSON.parse(savedMessages);
        }
        
        const savedFiles = localStorage.getItem('fileHistory');
        if (savedFiles) {
            const filesData = JSON.parse(savedFiles);
            filesData.forEach(fileData => {
                this.files.set(fileData.id, fileData);
            });
        }
        
        const savedPeerStates = localStorage.getItem('peerStates');
        if (savedPeerStates) {
            const states = JSON.parse(savedPeerStates);
            states.forEach(state => {
                this.peerStates.set(state.peerId, state);
            });
        }
        
        const savedLastSync = localStorage.getItem('lastSyncTime');
        if (savedLastSync) {
            this.lastSyncTime = parseInt(savedLastSync);
        }
    }
    
    // Сохранение данных в LocalStorage
    saveToStorage() {
        const peersArray = [];
        this.peers.forEach((peerData, id) => {
            peersArray.push(peerData);
        });
        localStorage.setItem('knownPeers', JSON.stringify(peersArray));
        
        localStorage.setItem('messageHistory', JSON.stringify(this.messages));
        
        const filesData = [];
        this.files.forEach((fileData, id) => {
            filesData.push(fileData);
        });
        localStorage.setItem('fileHistory', JSON.stringify(filesData));
        
        const statesArray = [];
        this.peerStates.forEach((state, peerId) => {
            statesArray.push(state);
        });
        localStorage.setItem('peerStates', JSON.stringify(statesArray));
        
        localStorage.setItem('lastSyncTime', this.lastSyncTime.toString());
    }
    
    // Сохранение предложения для пира
    savePeerOffer(peerId, offer) {
        const peerData = this.peers.get(peerId) || { id: peerId };
        peerData.lastOffer = offer;
        peerData.lastSeen = Date.now();
        this.peers.set(peerId, peerData);
        this.saveToStorage();
    }
    
    // Настройка обработчиков событий
    setupEventListeners() {
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
    }
    
    // Запуск мониторинга пиров
    startPeerMonitoring() {
        // Проверка состояния пиров каждые 10 секунд
        setInterval(() => {
            this.checkPeersStatus();
        }, 10000);
        
        // Автоматическое обновление SDP каждые 30 секунд для поддержания соединения
        setInterval(() => {
            this.refreshConnections();
        }, 30000);
    }
    
    // Проверка состояния пиров
    checkPeersStatus() {
        console.log('Проверка состояния пиров...');
        
        this.dataChannels.forEach((channel, peerId) => {
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
        
        console.log('Обновление соединений...');
        
        this.connectedPeers.forEach(peerId => {
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
            
            console.log(`Обновлены ICE кандидаты для пира ${peerId}`);
        } catch (error) {
            console.error(`Ошибка обновления ICE кандидатов для ${peerId}:`, error);
        }
    }
    
    // Синхронизация с пиром
    syncWithPeer(peerId) {
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
    
    // Очистка чата
    clearChat() {
        if (confirm('Вы уверены, что хотите очистить всю историю чата? Это действие нельзя отменить.')) {
            this.messages = [];
            this.files.clear();
            this.lastSyncTime = 0;
            this.saveToStorage();
            this.updateUI();
            console.log('Чат очищен');
        }
    }
    
    // Полная очистка всех данных (команда kill)
    killAllData() {
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
    }
    
    // Обновление интерфейса
    updateUI() {
        document.getElementById('localPeerId').textContent = this.localPeerId;
        this.updatePeerList();
        document.getElementById('connectedPeersCount').textContent = this.connectedPeers.size;
        
        const networkStatus = document.getElementById('networkStatus');
        if (this.isOnline) {
            networkStatus.classList.remove('offline');
            networkStatus.querySelector('span').textContent = 'Сеть активна';
        } else {
            networkStatus.classList.add('offline');
            networkStatus.querySelector('span').textContent = 'Сеть неактивна';
        }
        
        this.updateMessageHistory();
        this.saveToStorage();
    }
    
    // Обновление списка пиров в интерфейсе
    updatePeerList() {
        const peerList = document.getElementById('peerList');
        peerList.innerHTML = '';
        
        this.peers.forEach((peerData, peerId) => {
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
    }
    
    // Обновление истории сообщений в интерфейсе
    updateMessageHistory() {
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
    }
    
    // Форматирование размера файла
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // Кодирование в Base64
    encodeBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }
    
    // Декодирование из Base64
    decodeBase64(str) {
        return decodeURIComponent(escape(atob(str)));
    }
    
    // Создание предложения для подключения
    async createOffer() {
        try {
            // Создаем временный ID для нового пира
            const newPeerId = 'peer_' + Math.random().toString(36).substr(2, 9);
            
            // Создаем соединение
            const connection = new RTCPeerConnection(this.rtcConfig);
            this.connections.set(newPeerId, connection);
            
            // Создаем канал данных
            const dataChannel = connection.createDataChannel('messenger', { ordered: true });
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
            alert('Ошибка создания предложения: ' + error.message);
        }
    }
    
    // Финализация подключения к пиру
    finalizePeerConnection(temporaryPeerId) {
        // В реальном приложении здесь должен быть механизм определения реального ID пира
        // Для демонстрации оставляем временный ID
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
    }
    
    // Обновление отображения предложения после сбора ICE кандидатов
    updateOfferDisplay(peerId) {
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
        
        console.log('Предложение готово для копирования (в формате Base64)');
    }
    
    // Копирование предложения в буфер обмена
    copyOfferToClipboard() {
        const offerTextarea = document.getElementById('localOfferData');
        offerTextarea.select();
        document.execCommand('copy');
        alert('Предложение скопировано в буфер обмена. Отправьте его другому пользователю.');
    }
    
    // Обработка входящих сигнальных данных
    async processSignalData() {
        const signalInput = document.getElementById('remoteSignalInput');
        const signalDataStr = signalInput.value.trim();
        
        if (!signalDataStr) {
            alert('Введите сигнальные данные');
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
                alert('Неизвестный тип сигнальных данных');
            }
            
            signalInput.value = '';
            
        } catch (error) {
            console.error('Ошибка обработки сигнальных данных:', error);
            alert('Некорректные сигнальные данные: ' + error.message);
        }
    }
    
    // Обработка входящего предложения
    async handleOffer(signalData) {
        try {
            const peerId = signalData.peerId;
            
            if (this.peers.has(peerId)) {
                alert('Этот пир уже подключен');
                return;
            }
            
            // Создаем соединение
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
            alert('Ответ создан. Скопируйте его и отправьте обратно инициатору подключения.');
            
            this.updateUI();
            
        } catch (error) {
            console.error('Ошибка обработки предложения:', error);
            alert('Ошибка обработки предложения: ' + error.message);
        }
    }
    
    // Обработка входящего ответа
    async handleAnswer(signalData) {
        try {
            if (!this.pendingOffer) {
                alert('Нет ожидающих предложений');
                return;
            }
            
            const peerId = signalData.peerId;
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
            alert('Ошибка обработки ответа: ' + error.message);
        }
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
    
    // Обработка запроса синхронизации
    handleSyncRequest(request, peerId) {
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
    }
    
    // Обработка ответа синхронизации
    handleSyncResponse(response, peerId) {
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
    }
    
    // Добавление сообщения в историю с проверкой на дубликаты
    addMessageToHistory(message) {
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
    }
    
    // Удаление пира
    removePeer(peerId) {
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
            alert('Ошибка отправки файла');
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
}

// Инициализация приложения после загрузки страницы
document.addEventListener('DOMContentLoaded', () => {
    window.p2pClient = new P2PClient();
});