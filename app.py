"""
Flask сервер для аудио плеера с интеграцией MinIO хранилища.
Поддерживает загрузку, скачивание, удаление и получение списка треков.
"""

import os
import json
import hashlib
import base64
from datetime import datetime
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from minio import Minio
from minio.error import S3Error
from werkzeug.utils import secure_filename
from io import BytesIO

app = Flask(__name__)
CORS(app)

# Конфигурация MinIO
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'localhost:9000')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET = os.getenv('MINIO_BUCKET', 'music')
MINIO_SECURE = os.getenv('MINIO_SECURE', 'false').lower() == 'true'

# Инициализация клиента MinIO
minio_client = None

def get_minio_client():
    """Получить клиент MinIO с ленивой инициализацией."""
    global minio_client
    if minio_client is None:
        minio_client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE
        )
    return minio_client

def ensure_bucket_exists():
    """Убедиться, что бакет существует."""
    try:
        client = get_minio_client()
        if not client.bucket_exists(MINIO_BUCKET):
            client.make_bucket(MINIO_BUCKET)
        return True
    except Exception as e:
        print(f"Ошибка при создании бакета: {e}")
        return False

def allowed_file(filename):
    """Проверка разрешённого расширения файла."""
    allowed_extensions = {'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions

def get_file_metadata(filename):
    """Извлечь метаданные из имени файла."""
    # Удаляем расширение
    name_without_ext = os.path.splitext(filename)[0]
    # Предполагаем формат "Artist - Title" или просто "Title"
    if ' - ' in name_without_ext:
        parts = name_without_ext.split(' - ', 1)
        return {'artist': parts[0].strip(), 'title': parts[1].strip()}
    return {'artist': 'Неизвестный исполнитель', 'title': name_without_ext}

@app.route('/api/health', methods=['GET'])
def health_check():
    """Проверка здоровья сервера."""
    try:
        client = get_minio_client()
        bucket_exists = client.bucket_exists(MINIO_BUCKET)
        return jsonify({
            'status': 'ok',
            'minio_connected': True,
            'bucket_exists': bucket_exists,
            'bucket_name': MINIO_BUCKET
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'minio_connected': False,
            'error': str(e)
        }), 500

@app.route('/api/tracks', methods=['GET'])
def get_tracks():
    """Получить список всех треков из MinIO."""
    try:
        ensure_bucket_exists()
        client = get_minio_client()
        objects = client.list_objects(MINIO_BUCKET, recursive=True)
        
        tracks = []
        for obj in objects:
            if obj.object_name.endswith('/'):
                continue
            
            # Получаем метаданные объекта
            stat = client.stat_object(MINIO_BUCKET, obj.object_name)
            
            # Используем оригинальное имя файла из метаданных или имя объекта
            original_filename = stat.metadata.get('X-Amz-Meta-Original-Filename', obj.object_name)
            
            # Извлекаем метаданные из имени файла
            file_meta = get_file_metadata(original_filename)
            
            # Получаем метаданные из MinIO и декодируем из UTF-8 (были закодированы как latin-1)
            title = stat.metadata.get('X-Amz-Meta-Title')
            artist = stat.metadata.get('X-Amz-Meta-Artist')
            
            # Декодируем метаданные: они хранятся как latin-1, но содержат UTF-8 байты
            if title:
                try:
                    title = title.encode('latin-1').decode('utf-8')
                except (UnicodeDecodeError, AttributeError):
                    pass
            if artist:
                try:
                    artist = artist.encode('latin-1').decode('utf-8')
                except (UnicodeDecodeError, AttributeError):
                    pass
            
            track = {
                'id': hashlib.md5(obj.object_name.encode()).hexdigest()[:12],
                'fileName': obj.object_name,
                'originalFileName': original_filename,
                'title': title or file_meta['title'],
                'artist': artist or file_meta['artist'],
                'size': stat.size,
                'contentType': stat.content_type,
                'lastModified': stat.last_modified.isoformat() if stat.last_modified else None,
                'url': f'/api/tracks/{obj.object_name}'
            }
            tracks.append(track)
        
        return jsonify({'tracks': tracks, 'count': len(tracks)})
    
    except S3Error as e:
        return jsonify({'error': f'MinIO error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks/<path:filename>', methods=['GET'])
def get_track(filename):
    """Скачать трек из MinIO (потоковая передача)."""
    try:
        ensure_bucket_exists()
        client = get_minio_client()
        
        # Проверяем существование объекта
        try:
            stat = client.stat_object(MINIO_BUCKET, filename)
        except S3Error:
            return jsonify({'error': 'Track not found'}), 404
        
        # Получаем объект
        response = client.get_object(MINIO_BUCKET, filename)
        
        # Определяем content-type
        content_type = stat.content_type or 'audio/mpeg'
        
        # Потоковая передача данных
        def generate():
            try:
                for chunk in response.stream(32768):
                    yield chunk
            finally:
                response.close()
                response.release_conn()
        
        return Response(
            generate(),
            mimetype=content_type,
            headers={
                'Content-Disposition': f'inline; filename="{os.path.basename(filename)}"',
                'Cache-Control': 'public, max-age=31536000'
            }
        )
    
    except S3Error as e:
        return jsonify({'error': f'MinIO error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks', methods=['POST'])
def upload_track():
    """Загрузить трек в MinIO."""
    try:
        ensure_bucket_exists()
        
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        files = request.files.getlist('file')
        uploaded_tracks = []
        
        for file in files:
            if file.filename == '':
                continue
            
            if not allowed_file(file.filename):
                return jsonify({'error': f'File type not allowed: {file.filename}'}), 400
            
            # Получаем оригинальное имя файла
            original_filename = file.filename
            ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else 'mp3'
            
            # Кодируем имя файла в Base64 для безопасного использования в качестве ключа объекта
            # Это решает проблему SignatureDoesNotMatch с не-ASCII символами
            name_without_ext = original_filename.rsplit('.', 1)[0]
            safe_name = base64.urlsafe_b64encode(name_without_ext.encode('utf-8')).decode('ascii')
            safe_filename = f"{safe_name}.{ext}"
            
            # Читаем файл в память
            file_data = file.read()
            file_size = len(file_data)
            
            # Извлекаем метаданные из оригинального имени
            file_meta = get_file_metadata(original_filename)
            
            # Метаданные для MinIO - кодируем в UTF-8 явно для избежания ошибок с не-ASCII символами
            # MinIO/S3 требует чтобы значения метаданных были ASCII, поэтому кодируем Unicode в UTF-8 байты
            metadata = {
                'X-Amz-Meta-Title': file_meta['title'].encode('utf-8').decode('latin-1'),
                'X-Amz-Meta-Artist': file_meta['artist'].encode('utf-8').decode('latin-1'),
                'X-Amz-Meta-Uploaded-At': datetime.utcnow().isoformat(),
                'X-Amz-Meta-Original-Filename': original_filename.encode('utf-8').decode('latin-1')
            }
            
            # Загружаем в MinIO
            client = get_minio_client()
            client.put_object(
                MINIO_BUCKET,
                safe_filename,
                BytesIO(file_data),
                file_size,
                content_type=file.content_type or 'audio/mpeg',
                metadata=metadata
            )
            
            track = {
                'id': hashlib.md5(safe_filename.encode()).hexdigest()[:12],
                'fileName': safe_filename,
                'originalFileName': original_filename,
                'title': file_meta['title'],
                'artist': file_meta['artist'],
                'size': file_size,
                'url': f'/api/tracks/{safe_filename}'
            }
            uploaded_tracks.append(track)
        
        return jsonify({
            'message': f'Uploaded {len(uploaded_tracks)} track(s)',
            'tracks': uploaded_tracks
        }), 201
    
    except S3Error as e:
        return jsonify({'error': f'MinIO error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks/<path:filename>', methods=['DELETE'])
def delete_track(filename):
    """Удалить трек из MinIO."""
    try:
        ensure_bucket_exists()
        client = get_minio_client()
        
        # Проверяем существование объекта
        try:
            client.stat_object(MINIO_BUCKET, filename)
        except S3Error:
            return jsonify({'error': 'Track not found'}), 404
        
        # Удаляем объект
        client.remove_object(MINIO_BUCKET, filename)
        
        return jsonify({'message': f'Track "{filename}" deleted successfully'})
    
    except S3Error as e:
        return jsonify({'error': f'MinIO error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks/batch-delete', methods=['POST'])
def batch_delete_tracks():
    """Удалить несколько треков."""
    try:
        ensure_bucket_exists()
        data = request.get_json()
        
        if not data or 'filenames' not in data:
            return jsonify({'error': 'No filenames provided'}), 400
        
        filenames = data['filenames']
        client = get_minio_client()
        deleted = []
        errors = []
        
        for filename in filenames:
            try:
                client.remove_object(MINIO_BUCKET, filename)
                deleted.append(filename)
            except Exception as e:
                errors.append({'filename': filename, 'error': str(e)})
        
        return jsonify({
            'message': f'Deleted {len(deleted)} track(s)',
            'deleted': deleted,
            'errors': errors
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/config', methods=['GET'])
def get_config():
    """Получить конфигурацию для клиента."""
    return jsonify({
        'minio_endpoint': MINIO_ENDPOINT,
        'bucket': MINIO_BUCKET,
        'max_file_size_mb': 100,
        'allowed_formats': ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus']
    })

# Статические файлы для фронтенда
@app.route('/')
def serve_index():
    """Отдать index.html."""
    return send_file('index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """Отдать статические файлы."""
    # Проверяем существование файла перед отправкой
    if not os.path.exists(filename):
        # Если запрошен favicon и его нет, возвращаем пустой ответ
        if filename == 'favicon.ico':
            return '', 204
        return jsonify({'error': 'File not found'}), 404
    return send_file(filename)

if __name__ == '__main__':
    # Пробуем создать бакет при старте
    try:
        ensure_bucket_exists()
        print(f"✓ Бакет '{MINIO_BUCKET}' готов к работе")
    except Exception as e:
        print(f"⚠ Не удалось подготовить бакет: {e}")
        print("Убедитесь, что MinIO запущен и настройки верны")
    
    app.run(host='0.0.0.0', port=5000, debug=True)
