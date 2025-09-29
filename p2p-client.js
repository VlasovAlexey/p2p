// Основной класс P2P клиента
class P2PClient {
    constructor() {
        this.localPeerId = this.generatePeerId();
        this.connections = new Map(); // ID пира -> RTCPeerConnection
        this.dataChannels = new Map(); // ID пира -> RTCDataChannel
        this.peers = new Set(); // Все известные пиры
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
        
        this.init();
    }
    
    // Инициализация приложения
    init() {
        this.loadFromStorage();
        this.setupEventListeners();
        this.updateUI();
        
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
    
    // Загрузка данных из LocalStorage
    loadFromStorage() {
        const savedPeers = localStorage.getItem('knownPeers');
        if (savedPeers) {
            this.peers = new Set(JSON.parse(savedPeers));
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
    }
    
    // Сохранение данных в LocalStorage
    saveToStorage() {
        localStorage.setItem('knownPeers', JSON.stringify([...this.peers]));
        localStorage.setItem('messageHistory', JSON.stringify(this.messages));
        
        const filesData = [];
        this.files.forEach((fileData, id) => {
            filesData.push(fileData);
        });
        localStorage.setItem('fileHistory', JSON.stringify(filesData));
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
        
        this.peers.forEach(peerId => {
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
        
        this.messages.forEach(msg => {
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
                    this.connectedPeers.add(newPeerId);
                    this.isOnline = true;
                    this.updateUI();
                } else if (connection.connectionState === 'disconnected' || 
                          connection.connectionState === 'failed') {
                    this.connectedPeers.delete(newPeerId);
                    if (this.connectedPeers.size === 0) {
                        this.isOnline = false;
                    }
                    this.updateUI();
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
        
        document.getElementById('localOfferData').value = JSON.stringify(signalData, null, 2);
        document.getElementById('copyOfferBtn').disabled = false;
        
        console.log('Предложение готово для копирования');
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
            const signalData = JSON.parse(signalDataStr);
            
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
            this.peers.add(peerId);
            
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
            
            // Показываем ответ для копирования
            document.getElementById('localOfferData').value = JSON.stringify(answerSignalData, null, 2);
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
            this.peers.add(peerId);
            
            // Обновляем ID пира на реальный
            this.connections.delete(this.pendingOffer.peerId);
            this.connections.set(peerId, connection);
            
            // Устанавливаем удаленный ответ
            await connection.setRemoteDescription(signalData.answer);
            
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
                this.messages.push({
                    id: this.generateMessageId(),
                    type: 'text',
                    content: message.content,
                    sender: peerId,
                    timestamp: Date.now()
                });
                
                this.updateUI();
                console.log(`Получено сообщение от ${peerId}: ${message.content}`);
                
            } else if (message.type === 'file') {
                const fileData = message.fileData;
                this.files.set(fileData.id, fileData);
                
                this.messages.push({
                    id: this.generateMessageId(),
                    type: 'file',
                    fileId: fileData.id,
                    sender: peerId,
                    timestamp: Date.now()
                });
                
                this.updateUI();
                console.log(`Получен файл от ${peerId}: ${fileData.name}`);
            }
            
        } catch (error) {
            console.error('Ошибка обработки входящего сообщения:', error);
        }
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
        
        this.messages.push({
            id: this.generateMessageId(),
            ...message
        });
        
        this.broadcastToPeers(JSON.stringify(message));
        
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
            
            this.messages.push({
                id: this.generateMessageId(),
                type: 'file',
                fileId: fileMessage.fileData.id,
                sender: this.localPeerId,
                timestamp: Date.now()
            });
            
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