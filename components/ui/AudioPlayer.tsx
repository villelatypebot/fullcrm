import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';

interface AudioPlayerProps {
    src: string;
    variant?: 'sent' | 'received' | 'preview';
}

/**
 * AudioPlayer - Accessible audio player with waveform visualization
 * 
 * Accessibility Features:
 * - Play/Pause button has proper aria-label
 * - Waveform progress bar is keyboard accessible
 * - Current time and duration announced via aria-valuenow/aria-valuemax
 */
const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, variant = 'received' }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [waveform, setWaveform] = useState<number[]>([]);

    // Generate a "premium" looking waveform
    useEffect(() => {
        const bars = 45; // More bars for smoother look
        const newWaveform = Array.from({ length: bars }, () => Math.max(0.2, Math.random() * 0.8 + 0.1));
        setWaveform(newWaveform);
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const updateProgress = () => {
            const safeDuration = audio.duration || 0;
            const safeCurrentTime = audio.currentTime || 0;
            setCurrentTime(safeCurrentTime);
            if (!safeDuration) {
                setProgress(0);
                return;
            }
            setProgress((safeCurrentTime / safeDuration) * 100);
        };

        const updateDuration = () => {
            setDuration(audio.duration || 0);
        };

        const onEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        };

        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', updateDuration);
        audio.addEventListener('ended', onEnded);

        return () => {
            audio.removeEventListener('timeupdate', updateProgress);
            audio.removeEventListener('loadedmetadata', updateDuration);
            audio.removeEventListener('ended', onEnded);
        };
    }, []);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const formatTime = (time: number) => {
        if (isNaN(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const seekTo = useCallback((percentage: number) => {
        if (audioRef.current && audioRef.current.duration) {
            audioRef.current.currentTime = percentage * audioRef.current.duration;
        }
    }, []);

    const handleSeekClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const percentage = x / width;
        seekTo(percentage);
    };

    const handleSeekKeyDown = (e: React.KeyboardEvent) => {
        const step = 0.05; // 5% steps
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            seekTo(Math.min(1, progress / 100 + step));
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            seekTo(Math.max(0, progress / 100 - step));
        }
    };

    // Styles Configuration
    const styles = {
        sent: {
            btn: 'bg-white text-purple-600 hover:bg-white/90',
            barActive: 'bg-white/90',
            barInactive: 'bg-white/30',
            text: 'text-white/90'
        },
        received: {
            btn: 'bg-blue-600 text-white hover:bg-blue-700',
            barActive: 'bg-blue-600',
            barInactive: 'bg-slate-300 dark:bg-slate-700',
            text: 'text-slate-500 dark:text-slate-400'
        },
        preview: {
            btn: 'bg-purple-600 text-white hover:bg-purple-700',
            barActive: 'bg-purple-600',
            barInactive: 'bg-slate-300 dark:bg-slate-700',
            text: 'text-slate-500 dark:text-slate-400'
        }
    };

    const currentStyle = styles[variant];

    return (
        <div className="flex items-center gap-3 min-w-[220px] py-1 select-none group" role="group" aria-label="Player de áudio">
            <audio ref={audioRef} src={src} className="hidden" />

            <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 shadow-sm focus-visible-ring ${currentStyle.btn}`}
            >
                {isPlaying ? <Pause size={14} fill="currentColor" aria-hidden="true" /> : <Play size={14} fill="currentColor" className="ml-0.5" aria-hidden="true" />}
            </button>

            <div className="flex flex-col gap-1 flex-1 min-w-0">
                {/* Waveform Visualization - Now a button for keyboard access */}
                <button
                    type="button"
                    onClick={handleSeekClick}
                    onKeyDown={handleSeekKeyDown}
                    aria-label="Barra de progresso do áudio"
                    aria-valuenow={Math.round(progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    role="slider"
                    className="flex items-center gap-[2px] h-6 cursor-pointer focus-visible-ring rounded"
                >
                    {waveform.map((height, index) => {
                        const barPercent = (index / waveform.length) * 100;
                        const isPlayed = barPercent < progress;

                        return (
                            <div
                                key={index}
                                className={`w-[3px] rounded-full transition-all duration-200 ${isPlayed ? currentStyle.barActive : currentStyle.barInactive}`}
                                style={{ height: `${Math.max(height * 100, 15)}%` }}
                                aria-hidden="true"
                            />
                        );
                    })}
                </button>
                <div className="flex justify-between items-center text-[10px] font-medium opacity-80 px-0.5">
                    <span className={currentStyle.text} aria-label="Tempo atual">
                        {formatTime(currentTime)}
                    </span>
                    <span className={currentStyle.text} aria-label="Duração total">
                        {formatTime(duration)}
                    </span>
                </div>
            </div>
        </div>
    );
};
export default AudioPlayer;
