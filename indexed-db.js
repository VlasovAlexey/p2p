// Менеджер IndexedDB для P2P Messenger
class IndexedDBManager {
    constructor() {
        this.dbName = 'P2PMessengerDB';
        this.version = 1;
        this.db = null;
        this.initPromise = null;
    }

    // Инициализация базы данных
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('Ошибка открытия IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB успешно открыта');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('Обновление структуры IndexedDB');

                // Создаем хранилище для сообщений
                if (!db.objectStoreNames.contains('messages')) {
                    const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
                    messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
                    messagesStore.createIndex('sender', 'sender', { unique: false });
                }

                // Создаем хранилище для файлов
                if (!db.objectStoreNames.contains('files')) {
                    const filesStore = db.createObjectStore('files', { keyPath: 'id' });
                    filesStore.createIndex('name', 'name', { unique: false });
                    filesStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // Создаем хранилище для пиров
                if (!db.objectStoreNames.contains('peers')) {
                    const peersStore = db.createObjectStore('peers', { keyPath: 'id' });
                    peersStore.createIndex('lastSeen', 'lastSeen', { unique: false });
                }

                // Создаем хранилище для состояний пиров
                if (!db.objectStoreNames.contains('peerStates')) {
                    db.createObjectStore('peerStates', { keyPath: 'peerId' });
                }

                // Создаем хранилище для настроек приложения
                if (!db.objectStoreNames.contains('appSettings')) {
                    db.createObjectStore('appSettings', { keyPath: 'key' });
                }

                console.log('Структура IndexedDB создана');
            };
        });

        return this.initPromise;
    }

    // Получить настройку приложения
    async getSetting(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['appSettings'], 'readonly');
            const store = transaction.objectStore('appSettings');
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить настройку приложения
    async setSetting(key, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['appSettings'], 'readwrite');
            const store = transaction.objectStore('appSettings');
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить все сообщения
    async getAllMessages() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readonly');
            const store = transaction.objectStore('messages');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить сообщение
    async saveMessage(message) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readwrite');
            const store = transaction.objectStore('messages');
            const request = store.put(message);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить несколько сообщений
    async saveMessages(messages) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readwrite');
            const store = transaction.objectStore('messages');
            
            messages.forEach(message => {
                store.put(message);
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // Удалить все сообщения
    async clearMessages() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readwrite');
            const store = transaction.objectStore('messages');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить все файлы
    async getAllFiles() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить файл
    async saveFile(fileData) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.put(fileData);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Удалить все файлы
    async clearFiles() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить файл по ID
    async getFile(fileId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(fileId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Удалить файл по ID
    async deleteFile(fileId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.delete(fileId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить всех пиров
    async getAllPeers() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peers'], 'readonly');
            const store = transaction.objectStore('peers');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить пира
    async savePeer(peerData) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peers'], 'readwrite');
            const store = transaction.objectStore('peers');
            const request = store.put(peerData);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить несколько пиров
    async savePeers(peersArray) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peers'], 'readwrite');
            const store = transaction.objectStore('peers');
            
            peersArray.forEach(peer => {
                store.put(peer);
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // Удалить пира по ID
    async deletePeer(peerId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peers'], 'readwrite');
            const store = transaction.objectStore('peers');
            const request = store.delete(peerId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Удалить всех пиров
    async clearPeers() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peers'], 'readwrite');
            const store = transaction.objectStore('peers');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить состояние пира
    async getPeerState(peerId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peerStates'], 'readonly');
            const store = transaction.objectStore('peerStates');
            const request = store.get(peerId);

            request.onsuccess = () => resolve(request.result ? request.result.state : null);
            request.onerror = () => reject(request.error);
        });
    }

    // Сохранить состояние пира
    async savePeerState(peerId, state) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peerStates'], 'readwrite');
            const store = transaction.objectStore('peerStates');
            const request = store.put({ peerId, state });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить все состояния пиров
    async getAllPeerStates() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peerStates'], 'readonly');
            const store = transaction.objectStore('peerStates');
            const request = store.getAll();

            request.onsuccess = () => {
                const result = {};
                request.result.forEach(item => {
                    result[item.peerId] = item.state;
                });
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Удалить все состояния пиров
    async clearPeerStates() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peerStates'], 'readwrite');
            const store = transaction.objectStore('peerStates');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Получить время последней синхронизации
    async getLastSyncTime() {
        const result = await this.getSetting('lastSyncTime');
        return result ? parseInt(result) : 0;
    }

    // Сохранить время последней синхронизации
    async setLastSyncTime(timestamp) {
        return this.setSetting('lastSyncTime', timestamp.toString());
    }

    // Получить ID пира
    async getPeerId() {
        return this.getSetting('peerId');
    }

    // Сохранить ID пира
    async setPeerId(peerId) {
        return this.setSetting('peerId', peerId);
    }

    // Очистить все данные приложения
    async clearAllData() {
        await this.init();
        
        const clearPromises = [
            this.clearMessages(),
            this.clearFiles(),
            this.clearPeers(),
            this.clearPeerStates()
        ];

        // Очищаем настройки кроме peerId
        const currentPeerId = await this.getPeerId();
        await this.setSetting('lastSyncTime', '0');
        
        // Если peerId был, сохраняем его заново
        if (currentPeerId) {
            await this.setPeerId(currentPeerId);
        }

        return Promise.all(clearPromises);
    }

    // Получить статистику базы данных
    async getDatabaseStats() {
        await this.init();
        
        const stats = {};
        const storeNames = ['messages', 'files', 'peers', 'peerStates', 'appSettings'];
        
        for (const storeName of storeNames) {
            stats[storeName] = await this.getStoreCount(storeName);
        }
        
        return stats;
    }

    // Получить количество записей в хранилище
    async getStoreCount(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Глобальный экземпляр менеджера IndexedDB
window.indexedDBManager = new IndexedDBManager();
