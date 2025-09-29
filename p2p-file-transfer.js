// Функционал передачи файлов с чанкованием
P2PClient.prototype.handleFileTransferStart = function(message, peerId) {
    console.log(`Начало передачи файла от ${peerId}: ${message.fileName}`);
    
    // Создаем объект для сборки файла
    const transferData = {
        transferId: message.transferId,
        fileName: message.fileName,
        fileSize: message.fileSize,
        fileType: message.fileType,
        totalChunks: message.totalChunks,
        receivedChunks: new Array(message.totalChunks),
        receivedCount: 0,
        startTime: Date.now(),
        sender: peerId
    };
    
    this.fileTransfers.set(message.transferId, transferData);
};

P2PClient.prototype.handleFileTransferChunk = function(message, peerId) {
    const transfer = this.fileTransfers.get(message.transferId);
    if (!transfer) {
        console.warn(`Получен чанк для неизвестной передачи: ${message.transferId}`);
        return;
    }

    // Сохраняем чанк
    if (!transfer.receivedChunks[message.chunkIndex]) {
        transfer.receivedChunks[message.chunkIndex] = message.data;
        transfer.receivedCount++;
        
        console.log(`Получен чанк ${message.chunkIndex + 1}/${transfer.totalChunks} для ${transfer.fileName}`);
        
        // Проверяем, все ли чанки получены
        if (transfer.receivedCount === transfer.totalChunks) {
            this.assembleFileFromChunks(message.transferId);
        }
    }
};

P2PClient.prototype.assembleFileFromChunks = async function(transferId) {
    const transfer = this.fileTransfers.get(transferId);
    if (!transfer) return;

    try {
        // Собираем все чанки в один base64
        let fullBase64 = '';
        for (let i = 0; i < transfer.totalChunks; i++) {
            if (transfer.receivedChunks[i]) {
                fullBase64 += transfer.receivedChunks[i];
            } else {
                throw new Error(`Отсутствует чанк ${i}`);
            }
        }

        // Конвертируем base64 в DataURL
        const dataUrl = `data:${transfer.fileType};base64,${fullBase64}`;
        
        // Сохраняем файл
        const fileData = {
            id: transferId,
            name: transfer.fileName,
            type: transfer.fileType,
            size: transfer.fileSize,
            data: dataUrl,
            url: dataUrl
        };

        this.files.set(transferId, fileData);

        // Добавляем сообщение в историю
        this.addMessageToHistory({
            id: this.generateMessageId(),
            type: 'file',
            fileId: transferId,
            sender: transfer.sender,
            timestamp: Date.now()
        });

        this.fileTransfers.delete(transferId);
        
        const duration = Date.now() - transfer.startTime;
        console.log(`Файл собран: ${transfer.fileName}, время: ${duration}ms`);
        
        this.updateUI();

    } catch (error) {
        console.error(`Ошибка сборки файла ${transferId}:`, error);
        this.handleFileTransferError(transferId, `Ошибка сборки: ${error.message}`);
    }
};

P2PClient.prototype.handleFileTransferComplete = function(message, peerId) {
    console.log(`Передача файла завершена: ${message.transferId}`);
    // Файл уже должен быть собран из чанков
    // Можно очистить transfer если он еще существует
    this.fileTransfers.delete(message.transferId);
};

P2PClient.prototype.handleFileTransferError = function(message, peerId) {
    console.error(`Ошибка передачи файла от ${peerId}:`, message.error);
    this.fileTransfers.delete(message.transferId);
    this.showMessageModal('Ошибка', `Ошибка при получении файла: ${message.error}`);
};

// Старый метод отправки файла (для небольших файлов)
P2PClient.prototype.sendSmallFile = async function(file) {
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

        // Проверяем размер сообщения
        const messageString = JSON.stringify(fileMessage);
        if (messageString.length > 256 * 1024) {
            throw new Error('Файл слишком большой для отправки без чанкования');
        }

        this.files.set(fileMessage.fileData.id, fileMessage.fileData);
        
        const messageWithId = {
            id: this.generateMessageId(),
            type: 'file',
            fileId: fileMessage.fileData.id,
            sender: this.localPeerId,
            timestamp: Date.now()
        };

        this.addMessageToHistory(messageWithId);
        
        // Пытаемся отправить несколько раз если нужно
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            if (this.broadcastToPeers(JSON.stringify(fileMessage))) {
                break;
            }
            attempts++;
            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        if (attempts === maxAttempts) {
            throw new Error('Не удалось отправить файл после нескольких попыток');
        }

        this.updateUI();
        console.log(`Отправлен файл: ${file.name}`);
        
    } catch (error) {
        console.error('Ошибка отправки файла:', error);
        this.showMessageModal('Ошибка', 'Ошибка отправки файла: ' + error.message);
    }
};

// Чтение файла как Data URL (для обратной совместимости)
P2PClient.prototype.readFileAsDataURL = function(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};
