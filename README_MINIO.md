# Аудио Плеер с MinIO облачным хранилищем

## Обзор

Этот проект представляет собой веб-аудиоплеер с интеграцией объектного хранилища MinIO для постоянного хранения музыкальных треков.

## Компоненты системы

### 1. Flask сервер (app.py)
Python сервер, который предоставляет:
- REST API для управления треками
- Интеграцию с MinIO для хранения файлов
- Статическую раздачу фронтенда

### 2. MinIO хранилище
Объектное хранилище, совместимое с S3, для хранения аудиофайлов.

### 3. Веб-интерфейс
Аудиоплеер с возможностью:
- Загрузки файлов в облако
- Воспроизведения треков из облака
- Управления плейлистом

## Быстрый старт с Docker

### Требования
- Docker и Docker Compose

### Запуск

```bash
# Запуск всех сервисов
docker-compose up -d

# Проверка логов
docker-compose logs -f flask_app
docker-compose logs -f minio_server
```

### Доступ к сервисам

| Сервис | URL | Логин/Пароль |
|--------|-----|--------------|
| Аудиоплеер | http://localhost:5000 | - |
| MinIO Console | http://localhost:9001 | minioadmin/minioadmin |
| MinIO API | http://localhost:9000 | minioadmin/minioadmin |

## Ручная установка (без Docker)

### 1. Установка зависимостей

```bash
pip install -r requirements.txt
```

### 2. Настройка MinIO

#### Вариант A: Запуск MinIO через Docker

```bash
docker run -d \
    -p 9000:9000 \
    -p 9001:9001 \
    --name minio \
    -v minio_data:/data \
    -e MINIO_ROOT_USER=minioadmin \
    -e MINIO_ROOT_PASSWORD=minioadmin \
    minio/minio server /data --console-address ":9001"
```

#### Вариант B: Использование удалённого MinIO

Установите переменные окружения:

```bash
export MINIO_ENDPOINT=your-minio-server:9000
export MINIO_ACCESS_KEY=your-access-key
export MINIO_SECRET_KEY=your-secret-key
export MINIO_BUCKET=music
export MINIO_SECURE=false
```

### 3. Запуск Flask сервера

```bash
python app.py
```

Сервер запустится на http://localhost:5000

## API Endpoints

### GET /api/health
Проверка подключения к MinIO.

**Ответ:**
```json
{
    "status": "ok",
    "minio_connected": true,
    "bucket_exists": true,
    "bucket_name": "music"
}
```

### GET /api/tracks
Получить список всех треков.

**Ответ:**
```json
{
    "tracks": [
        {
            "id": "abc123",
            "fileName": "artist - song.mp3",
            "title": "song",
            "artist": "artist",
            "size": 5242880,
            "contentType": "audio/mpeg",
            "lastModified": "2024-01-01T12:00:00",
            "url": "/api/tracks/artist%20-%20song.mp3"
        }
    ],
    "count": 1
}
```

### POST /api/tracks
Загрузить один или несколько треков.

**Request:** `multipart/form-data` с полем `file`

**Ответ:**
```json
{
    "message": "Uploaded 1 track(s)",
    "tracks": [...]
}
```

### GET /api/tracks/<filename>
Скачать трек (потоковая передача).

### DELETE /api/tracks/<filename>
Удалить трек.

**Ответ:**
```json
{
    "message": "Track \"filename.mp3\" deleted successfully"
}
```

### POST /api/tracks/batch-delete
Удалить несколько треков.

**Request:**
```json
{
    "filenames": ["file1.mp3", "file2.mp3"]
}
```

### GET /api/config
Получить конфигурацию сервера.

## Интерфейс пользователя

### Кнопки управления

| Кнопка | Описание |
|--------|----------|
| 📁 Добавить файлы | Локальная загрузка файлов (временная) |
| ☁️ В облако | Загрузка файлов в MinIO (постоянное хранение) |
| 🔄 Обновить | Обновить список треков из облака |
| 💾 Экспорт | Экспорт плейлиста в JSON |
| 📂 Импорт | Импорт плейлиста из JSON |
| 🗑️ Очистить | Очистить плейлист |

### Индикатор состояния облака

В верхней части интерфейса отображается индикатор подключения к MinIO:
- 🟢 **MinIO подключено** - сервер подключён к хранилищу
- 🔴 **Отключено** - соединение с MinIO отсутствует

## Поддерживаемые форматы

- MP3
- WAV
- OGG
- FLAC
- AAC
- M4A
- WMA
- OPUS

## Конфигурация

Переменные окружения для настройки:

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| MINIO_ENDPOINT | localhost:9000 | Адрес MinIO сервера |
| MINIO_ACCESS_KEY | minioadmin | Access key для авторизации |
| MINIO_SECRET_KEY | minioadmin | Secret key для авторизации |
| MINIO_BUCKET | music | Имя бакета для хранения |
| MINIO_SECURE | false | Использовать HTTPS |

## Структура проекта

```
/workspace/
├── app.py              # Flask сервер
├── index.html          # HTML интерфейс
├── script.js           # JavaScript логика (с MinIO интеграцией)
├── styles.css          # Стили
├── requirements.txt    # Python зависимости
├── Dockerfile          # Docker образ для приложения
├── docker-compose.yml  # Docker Compose конфигурация
├── .env.example        # Пример файла окружения
└── README_MINIO.md     # Эта документация
```

## Безопасность

⚠️ **Важно:** Для продакшена измените учётные данные MinIO:

1. Создайте нового пользователя в MinIO Console
2. Обновите переменные окружения:
   ```bash
   export MINIO_ACCESS_KEY=your-secure-key
   export MINIO_SECRET_KEY=your-secure-secret
   ```

## Устранение неполадок

### Ошибка подключения к MinIO

1. Проверьте, запущен ли MinIO:
   ```bash
   docker ps | grep minio
   ```

2. Проверьте логи Flask приложения:
   ```bash
   docker-compose logs flask_app
   ```

3. Убедитесь, что правильный endpoint указан в настройках

### Файлы не загружаются

1. Проверьте права доступа к бакету в MinIO Console
2. Убедитесь, что формат файла поддерживается
3. Проверьте размер файла (лимит 100MB по умолчанию)

### Треки не воспроизводятся

1. Проверьте консоль браузера на наличие ошибок CORS
2. Убедитесь, что Flask сервер отдаёт правильные Content-Type
3. Проверьте, что файл существует в MinIO

## Лицензия

MIT License
