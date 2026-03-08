// Constants
const VOLUME_STEP = 5;
const DEFAULT_VOLUME = 75;
const MAX_VOLUME = 100;
const RESTART_THRESHOLD = 3; // seconds

// Audio Player State
const state = {
    playlist: [],
    currentTrackIndex: -1,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 'off', // 'off', 'all', 'one'
    shuffledIndices: [],
    volume: DEFAULT_VOLUME,
    isMuted: false
};

// DOM Elements
const audioPlayer = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const progressBar = document.getElementById('progressBar');
const volumeBar = document.getElementById('volumeBar');
const volumeIcon = document.getElementById('volumeIcon');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const trackTitle = document.querySelector('.track-title');
const trackArtist = document.querySelector('.track-artist');
const playlistEl = document.getElementById('playlist');
const trackCountEl = document.getElementById('trackCount');
const fileInput = document.getElementById('fileInput');
const exportBtn = document.getElementById('exportBtn');
const importInput = document.getElementById('importInput');
const clearBtn = document.getElementById('clearBtn');
const shuffleModeBtn = document.getElementById('shuffleModeBtn');
const repeatModeBtn = document.getElementById('repeatModeBtn');
const uploadToMinioBtn = document.getElementById('uploadToMinioBtn');
const loadFromMinioBtn = document.getElementById('loadFromMinioBtn');

// Volume mute state
let previousVolume = DEFAULT_VOLUME / 100;

// Initialize
function init() {
    setupEventListeners();
    loadPlaylistFromStorage();
    updateVolumeDisplay();
    updatePlaylistDisplay();
}

// Show Error Notification
function showError(message) {
    // Создаем элемент уведомления, если его нет
    let errorEl = document.getElementById('errorNotification');
    
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'errorNotification';
        errorEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4444;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 400px;
            font-size: 14px;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
        `;
        document.body.appendChild(errorEl);
    }
    
    errorEl.textContent = message;
    errorEl.style.opacity = '1';
    errorEl.style.transform = 'translateX(0)';
    
    // Скрываем через 5 секунд
    setTimeout(() => {
        errorEl.style.opacity = '0';
        errorEl.style.transform = 'translateX(100%)';
    }, 5000);
}

// Setup Event Listeners
function setupEventListeners() {
    // Playback controls
    playBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', playPrevious);
    nextBtn.addEventListener('click', playNext);
    shuffleBtn.addEventListener('click', toggleShuffle);
    repeatBtn.addEventListener('click', cycleRepeatMode);

    // Progress and volume
    progressBar.addEventListener('input', seekTrack);
    volumeBar.addEventListener('input', setVolume);
    volumeIcon.addEventListener('click', toggleMute);

    // Audio events
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('ended', handleTrackEnd);
    audioPlayer.addEventListener('error', handleAudioError);

    // File handling
    fileInput.addEventListener('change', handleFileUpload);
    exportBtn.addEventListener('click', exportPlaylist);
    importInput.addEventListener('change', importPlaylist);
    clearBtn.addEventListener('click', clearPlaylist);
    uploadToMinioBtn.addEventListener('click', uploadToMinio);
    loadFromMinioBtn.addEventListener('click', loadFromMinio);

    // Playlist mode buttons
    shuffleModeBtn.addEventListener('click', toggleShuffle);
    repeatModeBtn.addEventListener('click', cycleRepeatMode);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);
}

// File Upload Handler
function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    
    if (files.length === 0) {
        showError('Файлы не выбраны');
        return;
    }
    
    let loadedCount = 0;
    let errorCount = 0;
    
    files.forEach(file => {
        if (file.type.startsWith('audio/')) {
            const url = URL.createObjectURL(file);
            const track = {
                id: Date.now() + Math.random(),
                title: file.name.replace(/\.[^/.]+$/, ''),
                artist: 'Неизвестный исполнитель',
                src: url,
                fileName: file.name,
                duration: 0
            };
            state.playlist.push(track);
            
            // Get duration
            const tempAudio = new Audio(url);
            tempAudio.addEventListener('loadedmetadata', () => {
                track.duration = tempAudio.duration;
                updatePlaylistDisplay();
            });
            
            tempAudio.addEventListener('error', () => {
                errorCount++;
                console.error(`Failed to load metadata for ${file.name}`);
                // Очищаем blob URL при ошибке
                try {
                    URL.revokeObjectURL(url);
                } catch (err) {
                    console.warn('Failed to revoke blob URL:', err);
                }
            });
            
            loadedCount++;
        } else {
            errorCount++;
            console.warn(`Skipping non-audio file: ${file.name}`);
        }
    });

    savePlaylistToStorage();
    updatePlaylistDisplay();
    
    // Play first track if nothing is playing
    if (state.playlist.length === loadedCount && !state.isPlaying && loadedCount > 0) {
        loadTrack(0);
    }
    
    // Показываем уведомление о результатах загрузки
    if (errorCount > 0) {
        showError(`Загружено файлов: ${loadedCount}, ошибок: ${errorCount}`);
    }

    // Clear input
    fileInput.value = '';
}

// Upload to MinIO
async function uploadToMinio() {
    const files = Array.from(fileInput.files);
    
    if (files.length === 0) {
        showError('Файлы не выбраны');
        return;
    }
    
    const formData = new FormData();
    files.forEach(file => {
        if (file.type.startsWith('audio/')) {
            formData.append('file', file);
        }
    });
    
    if (formData.getAll('file').length === 0) {
        showError('Нет аудиофайлов для загрузки');
        return;
    }
    
    try {
        uploadToMinioBtn.disabled = true;
        uploadToMinioBtn.textContent = '⏳ Загрузка...';
        
        const response = await fetch('/api/tracks', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка загрузки');
        }
        
        const result = await response.json();
        showError(`✓ Загружено в MinIO: ${result.message}`);
        
        // Очищаем input после успешной загрузки
        fileInput.value = '';
        
        // Обновляем плейлист из MinIO
        await loadFromMinio();
        
    } catch (error) {
        console.error('Upload error:', error);
        showError(`Ошибка загрузки в MinIO: ${error.message}`);
    } finally {
        uploadToMinioBtn.disabled = false;
        uploadToMinioBtn.textContent = '☁️ В облако';
    }
}

// Load from MinIO
async function loadFromMinio() {
    try {
        loadFromMinioBtn.disabled = true;
        loadFromMinioBtn.textContent = '⏳ Загрузка...';
        
        const response = await fetch('/api/tracks');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка получения списка треков');
        }
        
        const data = await response.json();
        
        if (data.tracks.length === 0) {
            showError('В MinIO нет треков');
            return;
        }
        
        // Добавляем треки в плейлист
        data.tracks.forEach(track => {
            // Проверяем, есть ли уже такой трек в плейлисте
            const exists = state.playlist.some(t => t.fileName === track.fileName);
            if (!exists) {
                const playlistTrack = {
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    src: track.url,
                    fileName: track.fileName,
                    duration: 0,
                    size: track.size,
                    lastModified: track.lastModified
                };
                state.playlist.push(playlistTrack);
            }
        });
        
        savePlaylistToStorage();
        updatePlaylistDisplay();
        showError(`✓ Загружено из MinIO: ${data.count} треков`);
        
    } catch (error) {
        console.error('Load error:', error);
        showError(`Ошибка загрузки из MinIO: ${error.message}`);
    } finally {
        loadFromMinioBtn.disabled = false;
        loadFromMinioBtn.textContent = '⬇️ Из облака';
    }
}

// Playlist Display
function updatePlaylistDisplay() {
    trackCountEl.textContent = state.playlist.length;
    playlistEl.innerHTML = '';

    if (state.playlist.length === 0) {
        playlistEl.innerHTML = '<li class="empty-playlist">Плейлист пуст. Добавьте аудиофайлы!</li>';
        return;
    }

    state.playlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = `playlist-item ${index === state.currentTrackIndex ? 'active' : ''}`;
        li.innerHTML = `
            <span class="playlist-item-number">${index + 1}</span>
            <div class="playlist-item-info">
                <div class="playlist-item-title">${escapeHtml(track.title)}</div>
                <div class="playlist-item-duration">${formatTime(track.duration)}</div>
            </div>
            <button class="playlist-item-remove" data-index="${index}" title="Удалить">×</button>
        `;

        li.addEventListener('click', (e) => {
            if (!e.target.classList.contains('playlist-item-remove')) {
                loadTrack(index);
                playTrack();
            }
        });

        const removeBtn = li.querySelector('.playlist-item-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Проверяем, является ли трек из MinIO (имеет url, начинающийся с /api/)
            const isFromMinio = track.src && track.src.startsWith('/api/');
            removeTrack(index, isFromMinio);
        });

        playlistEl.appendChild(li);
    });

    // Scroll to active track
    const activeItem = playlistEl.querySelector('.playlist-item.active');
    if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Remove Track
function removeTrack(index, fromMinio = false) {
    const track = state.playlist[index];
    
    // Clean up blob URL to prevent memory leaks
    if (track && track.src && track.src.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(track.src);
        } catch (e) {
            console.warn('Failed to revoke blob URL:', e);
        }
    }
    
    // Если треки из MinIO, удаляем и с сервера
    if (fromMinio && track && track.fileName) {
        deleteTrackFromMinio(track.fileName);
    }
    
    state.playlist.splice(index, 1);
    
    if (state.currentTrackIndex >= state.playlist.length) {
        state.currentTrackIndex = Math.max(0, state.playlist.length - 1);
    }
    
    if (state.isShuffle) {
        state.shuffledIndices = state.shuffledIndices.filter(i => i !== index);
        state.shuffledIndices = state.shuffledIndices.map(i => i > index ? i - 1 : i);
    }
    
    savePlaylistToStorage();
    updatePlaylistDisplay();
    
    if (state.playlist.length === 0) {
        resetPlayer();
    } else if (index === state.currentTrackIndex) {
        loadTrack(state.currentTrackIndex);
    } else if (index < state.currentTrackIndex) {
        // Если удалили трек перед текущим, нужно обновить индекс
        state.currentTrackIndex--;
        loadTrack(state.currentTrackIndex);
    }
}

// Delete track from MinIO
async function deleteTrackFromMinio(filename) {
    try {
        const response = await fetch(`/api/tracks/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка удаления');
        }
        
        console.log(`✓ Удалено из MinIO: ${filename}`);
    } catch (error) {
        console.error('Delete error:', error);
        showError(`Ошибка удаления из MinIO: ${error.message}`);
    }
}

// Load Track
function loadTrack(index) {
    if (state.playlist.length === 0) return;
    
    state.currentTrackIndex = index;
    const track = state.playlist[index];
    
    // Проверка наличия источника
    if (!track || !track.src) {
        console.warn('No track source available');
        showError('Источник трека недоступен');
        return;
    }
    
    audioPlayer.src = track.src;
    trackTitle.textContent = track.title;
    trackArtist.textContent = track.artist;
    
    // Сбрасываем прогресс бар при загрузке нового трека
    progressBar.value = 0;
    currentTimeEl.textContent = '0:00';
    durationEl.textContent = '0:00';
    
    updatePlaylistDisplay();
}

// Playback Controls
function togglePlay() {
    if (state.playlist.length === 0) return;
    
    if (state.isPlaying) {
        pauseTrack();
    } else {
        playTrack();
    }
}

function playTrack() {
    if (state.playlist.length === 0) return;
    
    // Проверка наличия текущего трека
    const currentTrack = state.playlist[state.currentTrackIndex];
    if (!currentTrack || !currentTrack.src) {
        console.warn('No track selected or track source is missing');
        showError('Трек не выбран или источник отсутствует');
        return;
    }
    
    // Проверка валидности источника
    if (currentTrack.src.startsWith('blob:')) {
        // Проверяем, существует ли blob
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('HEAD', currentTrack.src, false);
            xhr.send();
            if (xhr.status === 404) {
                console.error('Blob URL is invalid or expired');
                showError('Файл недоступен. Пожалуйста, загрузите его снова.');
                return;
            }
        } catch (e) {
            // Игнорируем ошибки CORS для blob
        }
    }
    
    audioPlayer.play().then(() => {
        state.isPlaying = true;
        playBtn.textContent = '⏸️';
    }).catch(err => {
        console.error('Playback failed:', err);
        showError('Не удалось воспроизвести трек: ' + err.message);
        
        // Очищаем источник при ошибке
        audioPlayer.src = '';
        
        // Автоматический переход к следующему треку при ошибке
        if (err.name === 'NotSupportedError' || err.name === 'MediaElementSourceError') {
            setTimeout(() => {
                playNext();
            }, 500);
        }
    });
}

function pauseTrack() {
    audioPlayer.pause();
    state.isPlaying = false;
    playBtn.textContent = '▶️';
}

function playPrevious() {
    if (state.playlist.length === 0) return;
    
    // Проверка на валидность currentTime
    if (!isFinite(audioPlayer.currentTime)) {
        audioPlayer.currentTime = 0;
    } else if (audioPlayer.currentTime > RESTART_THRESHOLD) {
        try {
            audioPlayer.currentTime = 0;
        } catch (e) {
            console.error('Failed to reset currentTime:', e);
        }
    } else {
        let newIndex;
        if (state.isShuffle && state.shuffledIndices.length > 0) {
            const currentIndex = state.shuffledIndices.indexOf(state.currentTrackIndex);
            // Handle case when current track is not in shuffled indices
            if (currentIndex === -1) {
                // Start from the last track in shuffled order
                newIndex = state.shuffledIndices[state.shuffledIndices.length - 1];
            } else {
                newIndex = currentIndex > 0 
                    ? state.shuffledIndices[currentIndex - 1]
                    : state.shuffledIndices[state.shuffledIndices.length - 1];
            }
        } else {
            newIndex = state.currentTrackIndex - 1;
            if (newIndex < 0) newIndex = state.playlist.length - 1;
        }
        loadTrack(newIndex);
        playTrack();
    }
}

function playNext() {
    if (state.playlist.length === 0) return;
    
    let newIndex;
    if (state.isShuffle && state.shuffledIndices.length > 0) {
        const currentIndex = state.shuffledIndices.indexOf(state.currentTrackIndex);
        // Handle case when current track is not in shuffled indices
        if (currentIndex === -1) {
            // Start from the first track in shuffled order
            newIndex = state.shuffledIndices[0];
        } else {
            newIndex = currentIndex < state.shuffledIndices.length - 1
                ? state.shuffledIndices[currentIndex + 1]
                : state.shuffledIndices[0];
        }
    } else {
        newIndex = state.currentTrackIndex + 1;
        if (newIndex >= state.playlist.length) newIndex = 0;
    }
    loadTrack(newIndex);
    playTrack();
}

// Handle Track End
function handleTrackEnd() {
    if (state.playlist.length === 0) return;
    
    switch (state.repeatMode) {
        case 'one':
            try {
                audioPlayer.currentTime = 0;
                playTrack().catch(e => console.warn('Playback failed:', e));
            } catch (e) {
                console.error('Error restarting track:', e);
                playNext();
            }
            break;
        case 'all':
            playNext();
            break;
        default:
            if (state.currentTrackIndex < state.playlist.length - 1) {
                playNext();
            } else {
                pauseTrack();
            }
    }
}

// Handle Audio Error
function handleAudioError(e) {
    const error = audioPlayer.error;
    if (!error) return;
    
    let errorMessage = 'Ошибка воспроизведения';
    
    switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = 'Воспроизведение отменено пользователем';
            break;
        case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = 'Ошибка сети при загрузке аудио';
            break;
        case MediaError.MEDIA_ERR_DECODE:
            errorMessage = 'Ошибка декодирования аудиофайла';
            break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = 'Формат файла не поддерживается или файл поврежден';
            break;
        default:
            errorMessage = `Неизвестная ошибка: ${error.message}`;
    }
    
    console.error('Audio error:', errorMessage, error);
    showError(errorMessage);
    
    // Очищаем источник при ошибке загрузки
    audioPlayer.src = '';
    
    // Пытаемся переключиться на следующий трек
    if (state.currentTrackIndex < state.playlist.length - 1) {
        setTimeout(() => {
            playNext();
        }, 500);
    } else {
        // Если это последний трек, останавливаем плеер
        pauseTrack();
    }
}

// Shuffle
function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    
    if (state.isShuffle) {
        state.shuffledIndices = Array.from({ length: state.playlist.length }, (_, i) => i);
        // Fisher-Yates shuffle
        for (let i = state.shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [state.shuffledIndices[i], state.shuffledIndices[j]] = 
            [state.shuffledIndices[j], state.shuffledIndices[i]];
        }
        
        // Ensure current track is in the shuffled list
        if (!state.shuffledIndices.includes(state.currentTrackIndex)) {
            state.shuffledIndices.unshift(state.currentTrackIndex);
        }
    }
    
    shuffleBtn.classList.toggle('active', state.isShuffle);
    shuffleModeBtn.classList.toggle('active', state.isShuffle);
}

// Repeat Mode
function cycleRepeatMode() {
    const modes = ['none', 'all', 'one'];
    const currentIndex = modes.indexOf(state.repeatMode);
    state.repeatMode = modes[(currentIndex + 1) % modes.length];
    
    const icons = { none: '🔁', all: '🔂', one: '🔂' };
    const titles = { none: 'Повтор выкл', all: 'Повтор всех', one: 'Повтор одного' };
    
    repeatBtn.textContent = icons[state.repeatMode];
    repeatBtn.title = titles[state.repeatMode];
    repeatBtn.classList.toggle('active', state.repeatMode !== 'none');
    
    repeatModeBtn.classList.toggle('active', state.repeatMode !== 'none');
    repeatModeBtn.innerHTML = state.repeatMode === 'one' 
        ? '🔂 Повтор одного' 
        : (state.repeatMode === 'all' ? '🔁 Повтор всех' : '🔁 Повтор');
}

// Progress and Volume
function updateProgress() {
    // Проверка на валидность duration перед обновлением прогресса
    if (!audioPlayer.duration || !isFinite(audioPlayer.duration)) {
        return;
    }
    
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100 || 0;
    progressBar.value = progress;
    currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
}

function updateDuration() {
    // Проверка на валидность duration
    if (!audioPlayer.duration || !isFinite(audioPlayer.duration)) {
        console.warn('Invalid duration received');
        return;
    }
    
    durationEl.textContent = formatTime(audioPlayer.duration);
    
    // Update track duration in playlist
    if (state.playlist[state.currentTrackIndex]) {
        state.playlist[state.currentTrackIndex].duration = audioPlayer.duration;
        updatePlaylistDisplay();
    }
}

function seekTrack() {
    // Проверка на валидность duration
    if (!audioPlayer.duration || !isFinite(audioPlayer.duration)) {
        console.warn('Cannot seek: invalid duration');
        return;
    }
    
    const time = (progressBar.value / 100) * audioPlayer.duration;
    
    // Проверка на валидность времени
    if (!isFinite(time)) {
        console.warn('Cannot seek: invalid time value');
        return;
    }
    
    try {
        audioPlayer.currentTime = time;
    } catch (e) {
        console.error('Failed to set currentTime:', e);
    }
}

// Set Volume
function setVolume() {
    const volumeValue = parseInt(volumeBar.value);
    state.volume = volumeValue;
    audioPlayer.volume = volumeValue / 100;
    state.isMuted = (volumeValue === 0);
    updateVolumeIcon();
    // Save volume to localStorage
    localStorage.setItem('playerVolume', volumeValue.toString());
}

// Toggle Mute
function toggleMute() {
    state.isMuted = !state.isMuted;
    
    if (state.isMuted) {
        previousVolume = audioPlayer.volume;
        audioPlayer.volume = 0;
        volumeBar.value = 0;
        state.volume = 0;
    } else {
        const restoreVolume = previousVolume > 0 ? previousVolume : (DEFAULT_VOLUME / 100);
        audioPlayer.volume = restoreVolume;
        volumeBar.value = Math.round(restoreVolume * 100);
        state.volume = Math.round(restoreVolume * 100);
    }
    
    volumeIcon.classList.toggle('muted', state.isMuted);
    updateVolumeIconDisplay(audioPlayer.volume);
    localStorage.setItem('playerVolume', volumeBar.value);
}

// Update Volume Icon Display
function updateVolumeIcon() {
    const volume = audioPlayer.volume;
    updateVolumeIconDisplay(volume);
}

function updateVolumeIconDisplay(volume) {
    if (volume === 0) {
        volumeIcon.textContent = '🔇';
        volumeIcon.title = 'Включить звук';
    } else if (volume < 0.5) {
        volumeIcon.textContent = '🔉';
        volumeIcon.title = 'Выключить звук';
    } else {
        volumeIcon.textContent = '🔊';
        volumeIcon.title = 'Выключить звук';
    }
}

// Update Volume Display
function updateVolumeDisplay() {
    volumeBar.value = state.volume;
    audioPlayer.volume = state.volume / 100;
    updateVolumeIcon();
}

// Load saved volume
function loadSavedVolume() {
    const savedVolume = localStorage.getItem('playerVolume');
    if (savedVolume !== null) {
        const vol = parseInt(savedVolume);
        state.volume = vol;
        volumeBar.value = vol;
        audioPlayer.volume = vol / 100;
        state.isMuted = (vol === 0);
        previousVolume = vol > 0 ? vol / 100 : DEFAULT_VOLUME / 100;
        updateVolumeIcon();
    }
}

// Format Time
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Reset Player
function resetPlayer() {
    audioPlayer.src = '';
    trackTitle.textContent = 'Нет трека';
    trackArtist.textContent = 'Загрузите файлы для начала';
    pauseTrack();
    progressBar.value = 0;
    currentTimeEl.textContent = '0:00';
    durationEl.textContent = '0:00';
}

// Export Playlist
function exportPlaylist() {
    if (state.playlist.length === 0) {
        alert('Плейлист пуст!');
        return;
    }

    const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        tracks: state.playlist.map(track => ({
            title: track.title,
            artist: track.artist,
            fileName: track.fileName,
            duration: track.duration
        }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playlist-${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Import Playlist
function importPlaylist(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            
            if (!data.tracks || !Array.isArray(data.tracks)) {
                throw new Error('Неверный формат файла');
            }

            // Note: We can only import metadata, not the actual audio files
            // Users will need to re-add the files
            const importedTracks = data.tracks.map(track => ({
                id: Date.now() + Math.random(),
                title: track.title || 'Без названия',
                artist: track.artist || 'Неизвестный исполнитель',
                src: '',  // Empty source - user needs to re-add files
                fileName: track.fileName || '',
                duration: track.duration || 0
            }));

            state.playlist = [...state.playlist, ...importedTracks];
            savePlaylistToStorage();
            updatePlaylistDisplay();
            
            alert(`Импортировано ${importedTracks.length} треков.\n\nПримечание: Вам нужно будет повторно добавить аудиофайлы, так как сохраняются только метаданные.`);
            
        } catch (err) {
            showError('Ошибка при импорте плейлиста: ' + err.message);
        }
    };
    
    reader.readAsText(file);
    importInput.value = '';
}

// Clear Playlist
function clearPlaylist() {
    if (state.playlist.length === 0) return;
    
    if (confirm('Вы уверены, что хотите очистить плейлист?')) {
        // Clean up all blob URLs
        state.playlist.forEach(track => {
            if (track && track.src && track.src.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(track.src);
                } catch (e) {
                    console.warn('Failed to revoke blob URL:', e);
                }
            }
        });
        
        state.playlist = [];
        state.currentTrackIndex = -1;
        state.shuffledIndices = [];
        savePlaylistToStorage();
        updatePlaylistDisplay();
        resetPlayer();
    }
}

// Local Storage
function savePlaylistToStorage() {
    try {
        const data = {
            tracks: state.playlist.map(track => ({
                title: track.title,
                artist: track.artist,
                fileName: track.fileName,
                duration: track.duration
            })),
            currentTrackIndex: state.currentTrackIndex,
            isShuffle: state.isShuffle,
            repeatMode: state.repeatMode
        };
        localStorage.setItem('audioPlaylist', JSON.stringify(data));
    } catch (err) {
        console.warn('Не удалось сохранить плейлист:', err);
    }
}

function loadPlaylistFromStorage() {
    try {
        const saved = localStorage.getItem('audioPlaylist');
        if (saved) {
            const data = JSON.parse(saved);
            
            if (data.isShuffle !== undefined) {
                state.isShuffle = data.isShuffle;
                shuffleBtn.classList.toggle('active', state.isShuffle);
                shuffleModeBtn.classList.toggle('active', state.isShuffle);
            }
            
            if (data.repeatMode !== undefined) {
                state.repeatMode = data.repeatMode;
                const icons = { none: '🔁', all: '🔂', one: '🔂' };
                repeatBtn.textContent = icons[state.repeatMode];
                repeatBtn.classList.toggle('active', state.repeatMode !== 'none');
                repeatModeBtn.classList.toggle('active', state.repeatMode !== 'none');
            }
            
            if (data.currentTrackIndex !== undefined) {
                state.currentTrackIndex = data.currentTrackIndex;
            }
            
            // Load track metadata (without src since blob URLs don't persist)
            state.playlist = data.tracks || [];
        }
    } catch (err) {
        console.warn('Не удалось загрузить плейлист:', err);
    }
}

// Keyboard Shortcuts
function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT') return;
    
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            togglePlay();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            playPrevious();
            break;
        case 'ArrowRight':
            e.preventDefault();
            playNext();
            break;
        case 'ArrowUp':
            e.preventDefault();
            volumeBar.value = Math.min(MAX_VOLUME, parseInt(volumeBar.value) + VOLUME_STEP);
            setVolume();
            break;
        case 'ArrowDown':
            e.preventDefault();
            volumeBar.value = Math.max(0, parseInt(volumeBar.value) - VOLUME_STEP);
            setVolume();
            break;
        case 'KeyM':
            e.preventDefault();
            toggleMute();
            break;
    }
}

// Initialize on load
init();

// ============================================
// MinIO Cloud Storage Integration
// ============================================

const API_BASE_URL = window.location.origin;

// Загрузка треков из облака MinIO
async function loadTracksFromCloud() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/tracks`);
        if (!response.ok) throw new Error('Failed to fetch tracks');
        
        const data = await response.json();
        
        if (data.tracks && data.tracks.length > 0) {
            data.tracks.forEach(track => {
                state.playlist.push({
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    src: `${API_BASE_URL}${track.url}`,
                    fileName: track.fileName,
                    duration: 0,
                    isCloud: true
                });
            });
            
            savePlaylistToStorage();
            updatePlaylistDisplay();
            showError(`Загружено ${data.tracks.length} треков из облака`);
        }
    } catch (error) {
        console.error('Error loading tracks from cloud:', error);
        showError('Не удалось загрузить треки из облака: ' + error.message);
    }
}

// Загрузка файла в облако MinIO
async function uploadFileToCloud(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/tracks`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
        }
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error uploading file to cloud:', error);
        throw error;
    }
}

// Удаление трека из облака
async function deleteTrackFromCloud(fileName) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/tracks/${encodeURIComponent(fileName)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Delete failed');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error deleting track from cloud:', error);
        throw error;
    }
}

// Проверка доступности облака
async function checkCloudHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/health`);
        const data = await response.json();
        return data.minio_connected;
    } catch (error) {
        console.error('Cloud health check failed:', error);
        return false;
    }
}

// Модифицированная функция загрузки файлов с поддержкой облака
async function handleFileUploadWithCloud(e) {
    const files = Array.from(e.target.files);
    
    if (files.length === 0) {
        showError('Файлы не выбраны');
        return;
    }
    
    // Проверяем доступность облака
    const isCloudAvailable = await checkCloudHealth();
    
    let uploadedCount = 0;
    let errorCount = 0;
    
    for (const file of files) {
        if (!file.type.startsWith('audio/')) {
            errorCount++;
            continue;
        }
        
        try {
            if (isCloudAvailable) {
                // Загружаем в облако
                await uploadFileToCloud(file);
                uploadedCount++;
            } else {
                // Локальная загрузка (fallback)
                const url = URL.createObjectURL(file);
                const track = {
                    id: Date.now() + Math.random(),
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    artist: 'Неизвестный исполнитель',
                    src: url,
                    fileName: file.name,
                    duration: 0
                };
                state.playlist.push(track);
                
                const tempAudio = new Audio(url);
                tempAudio.addEventListener('loadedmetadata', () => {
                    track.duration = tempAudio.duration;
                    updatePlaylistDisplay();
                });
                uploadedCount++;
            }
        } catch (error) {
            errorCount++;
            console.error(`Failed to upload ${file.name}:`, error);
        }
    }
    
    // Если загрузка была в облако, обновляем список треков
    if (isCloudAvailable && uploadedCount > 0) {
        await loadTracksFromCloud();
    } else {
        savePlaylistToStorage();
        updatePlaylistDisplay();
    }
    
    if (errorCount > 0) {
        showError(`Загружено: ${uploadedCount}, ошибок: ${errorCount}`);
    } else {
        showError(`Успешно загружено ${uploadedCount} треков`);
    }
    
    fileInput.value = '';
}

// Добавление кнопки для загрузки в облако в интерфейс
function addCloudUploadButton() {
    const playlistHeader = document.querySelector('.playlist-header');
    if (!playlistHeader) return;
    
    const actionsDiv = playlistHeader.querySelector('.playlist-actions');
    if (!actionsDiv) return;
    
    // Кнопка загрузки в облако
    const cloudUploadBtn = document.createElement('button');
    cloudUploadBtn.className = 'action-btn cloud-upload-btn';
    cloudUploadBtn.id = 'cloudUploadBtn';
    cloudUploadBtn.innerHTML = '☁️ В облако';
    cloudUploadBtn.title = 'Загрузить выбранные файлы в MinIO облако';
    
    // Скрытый input для файлов
    const cloudFileInput = document.createElement('input');
    cloudFileInput.type = 'file';
    cloudFileInput.id = 'cloudFileInput';
    cloudFileInput.multiple = true;
    cloudFileInput.accept = 'audio/*';
    cloudFileInput.hidden = true;
    
    cloudUploadBtn.addEventListener('click', () => {
        cloudFileInput.click();
    });
    
    cloudFileInput.addEventListener('change', handleFileUploadWithCloud);
    
    actionsDiv.appendChild(cloudUploadBtn);
    actionsDiv.appendChild(cloudFileInput);
    
    // Кнопка обновления из облака
    const cloudRefreshBtn = document.createElement('button');
    cloudRefreshBtn.className = 'action-btn cloud-refresh-btn';
    cloudRefreshBtn.id = 'cloudRefreshBtn';
    cloudRefreshBtn.innerHTML = '🔄 Обновить';
    cloudRefreshBtn.title = 'Обновить список треков из облака';
    cloudRefreshBtn.addEventListener('click', loadTracksFromCloud);
    
    actionsDiv.appendChild(cloudRefreshBtn);
}

// Индикатор состояния облака
function addCloudStatusIndicator() {
    const header = document.querySelector('.header');
    if (!header) return;
    
    const cloudStatus = document.createElement('div');
    cloudStatus.className = 'cloud-status';
    cloudStatus.id = 'cloudStatus';
    cloudStatus.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #888;
    `;
    cloudStatus.innerHTML = `
        <span class="cloud-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #ff4444;"></span>
        <span class="cloud-status-text">Отключено</span>
    `;
    
    header.appendChild(cloudStatus);
    
    // Периодическая проверка статуса
    updateCloudStatus();
    setInterval(updateCloudStatus, 30000);
}

async function updateCloudStatus() {
    const statusDot = document.querySelector('.cloud-status-dot');
    const statusText = document.querySelector('.cloud-status-text');
    
    if (!statusDot || !statusText) return;
    
    const isConnected = await checkCloudHealth();
    
    if (isConnected) {
        statusDot.style.background = '#44ff44';
        statusText.textContent = 'MinIO подключено';
    } else {
        statusDot.style.background = '#ff4444';
        statusText.textContent = 'Отключено';
    }
}

// Инициализация интеграции с облаком при запуске
function initCloudIntegration() {
    addCloudUploadButton();
    addCloudStatusIndicator();
    
    // Автоматическая загрузка треков из облака при старте
    setTimeout(() => {
        loadTracksFromCloud();
    }, 1000);
}

// Вызываем инициализацию облака после основной инициализации
const originalInit = init;
init = function() {
    originalInit();
    initCloudIntegration();
};
