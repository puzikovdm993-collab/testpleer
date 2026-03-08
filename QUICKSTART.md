# Быстрый старт - Аудио Плеер с MinIO

## Вариант 1: Запуск через Docker Compose (Рекомендуется)

```bash
# Запустить всё одной командой
docker-compose up -d

# Открыть в браузере
# http://localhost:5000
```

**Сервисы:**
- 🎵 Аудиоплеер: http://localhost:5000
- ☁️ MinIO Console: http://localhost:9001 (minioadmin/minioadmin)

## Вариант 2: Ручной запуск

### Шаг 1: Запустить MinIO
```bash
docker run -d -p 9000:9000 -p 9001:9001 \
  --name minio -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

### Шаг 2: Установить зависимости Python
```bash
pip install -r requirements.txt
```

### Шаг 3: Запустить Flask сервер
```bash
python app.py
```

### Шаг 4: Открыть в браузере
```
http://localhost:5000
```

## Использование

### Загрузка музыки в облако:
1. Нажмите кнопку **"☁️ В облако"**
2. Выберите аудиофайлы (MP3, WAV, OGG, etc.)
3. Файлы загрузятся в MinIO хранилище

### Воспроизведение:
- Треки из облака загружаются автоматически при старте
- Или нажмите **"🔄 Обновить"** для обновления списка

### Индикатор состояния:
- 🟢 **MinIO подключено** - всё работает
- 🔴 **Отключено** - проверьте подключение к MinIO

## Остановка (для Docker)
```bash
docker-compose down
# или
docker stop minio
```
