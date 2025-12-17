/**
 * @fileoverview Hook de Reconhecimento de Fala
 * 
 * Hook que encapsula a Web Speech API para transcrição de voz em tempo real,
 * usado para entrada de voz no assistente de IA e formulários.
 * 
 * @module hooks/useSpeechRecognition
 * 
 * @example
 * ```tsx
 * function VoiceInput() {
 *   const { 
 *     isListening,
 *     transcript,
 *     startListening,
 *     stopListening,
 *     hasRecognitionSupport 
 *   } = useSpeechRecognition();
 *   
 *   if (!hasRecognitionSupport) {
 *     return <p>Seu navegador não suporta reconhecimento de voz</p>;
 *   }
 *   
 *   return (
 *     <div>
 *       <button onClick={isListening ? stopListening : startListening}>
 *         {isListening ? '⏹️ Parar' : '🎤 Ditado'}
 *       </button>
 *       <p>{transcript}</p>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Interface do retorno do hook useSpeechRecognition
 * 
 * @interface SpeechRecognitionHook
 */
interface SpeechRecognitionHook {
  /** Se está ativamente ouvindo */
  isListening: boolean;
  /** Texto transcrito da fala */
  transcript: string;
  /** Inicia o ditado (reconhecimento de fala) */
  startListening: () => void;
  /** Para o ditado (reconhecimento de fala) */
  stopListening: () => void;
  /** Limpa o transcript atual */
  resetTranscript: () => void;
  /** Se o navegador suporta a API */
  hasRecognitionSupport: boolean;
}

/**
 * Interface interna da Web Speech API
 * @internal
 */
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

/**
 * Evento de resultado da API
 * @internal
 */
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

/**
 * Evento de erro da API
 * @internal
 */
interface SpeechRecognitionErrorEvent {
  error: string;
}

/**
 * Hook para reconhecimento de fala usando Web Speech API
 * 
 * Fornece interface simples para capturar e transcrever fala do usuário
 * em tempo real. Configurado para português brasileiro (pt-BR).
 * 
 * @returns {SpeechRecognitionHook} Estado e controles do reconhecimento de fala
 * 
 * @example
 * ```tsx
 * function AudioNote() {
 *   const speech = useSpeechRecognition();
 *   const [savedNote, setSavedNote] = useState('');
 *   
 *   const handleSave = () => {
 *     setSavedNote(speech.transcript);
 *     speech.resetTranscript();
 *   };
 *   
 *   return (
 *     <div>
 *       <MicButton 
 *         active={speech.isListening}
 *         onClick={speech.isListening ? speech.stopListening : speech.startListening}
 *       />
 *       <LivePreview text={speech.transcript} />
 *       <button onClick={handleSave}>Salvar nota</button>
 *     </div>
 *   );
 * }
 * ```
 * 
 * @remarks
 * - Usa WebKit prefix para suporte a Safari/Chrome
 * - Modo contínuo com resultados intermediários
 * - Logs de debug no console para troubleshooting
 */
export const useSpeechRecognition = (): SpeechRecognitionHook => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recognition, setRecognition] = useState<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      interface WindowWithSpeechRecognition extends Window {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      }

      const win = window as WindowWithSpeechRecognition;
      const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        return;
      }

      const recognitionInstance = new SpeechRecognition();

      recognitionInstance.continuous = true;
      recognitionInstance.interimResults = true;
      recognitionInstance.lang = 'pt-BR';

      recognitionInstance.onstart = () => {
      };

      recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
      };

      recognitionInstance.onend = () => {
        setIsListening(false);
      };

      recognitionInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
        setIsListening(false);
      };

      setRecognition(recognitionInstance);

      return () => {
        // Cleanup para evitar listeners vivos e setState após unmount
        try {
          recognitionInstance.onstart = null;
          recognitionInstance.onresult = null;
          recognitionInstance.onend = null;
          recognitionInstance.onerror = null;
          recognitionInstance.stop();
        } catch {
          // ignore
        }
      };
    } else {
      // API not supported
    }
  }, []);

  const startListening = useCallback(() => {
    if (recognition && !isListening) {
      try {
        recognition.start();
        setIsListening(true);
      } catch (error) {
        console.error('Error starting recognition:', error);
      }
    }
  }, [recognition, isListening]);

  const stopListening = useCallback(() => {
    if (recognition && isListening) {
      recognition.stop();
      setIsListening(false);
    }
  }, [recognition, isListening]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    hasRecognitionSupport: !!recognition,
  };
};
