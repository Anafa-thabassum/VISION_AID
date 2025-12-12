import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Alert, ActivityIndicator } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';

const { width, height } = Dimensions.get('window');

// Replace with your actual Gemini API key
const GEMINI_API_KEY = 'AIzaSyAGJHfUx43vUB9Pekv8XedxLOKCtmIo1SU';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Language configuration
const LANGUAGES = [
  { code: 'en-IN', name: 'English', flag: '🇬🇧', script: 'Latin' },
  { code: 'ta-IN', name: 'Tamil', flag: '🇮🇳', script: 'Tamil' },
  { code: 'ml-IN', name: 'Malayalam', flag: '🇮🇳', script: 'Malayalam' },
  { code: 'te-IN', name: 'Telugu', flag: '🇮🇳', script: 'Telugu' },
];

const VisionAidApp = () => {
  const [currentMode, setCurrentMode] = useState('object'); // 'object' or 'text'
  const [isActive, setIsActive] = useState(false);
  const [detectedItems, setDetectedItems] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSpoken, setLastSpoken] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [lastDetectionTime, setLastDetectionTime] = useState(0);
  const [isApiReady, setIsApiReady] = useState(false);
  const [error, setError] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en-IN'); // Default to English
  const [detectedLanguage, setDetectedLanguage] = useState(null); // Track detected language for text mode
  const cameraRef = useRef(null);
  const processingQueue = useRef([]);
  const isProcessingRef = useRef(false);

  // Rate limiting: 5 seconds between API calls
  const RATE_LIMIT_MS = 5000;

  // Check API key on component mount
  useEffect(() => {
    console.log('[VisionAid] Component mounted');
    if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
      setIsApiReady(true);
      console.log('[VisionAid] Gemini API key configured');
    } else {
      console.warn('[VisionAid] Gemini API key not configured');
      Alert.alert('Configuration Required', 'Please add your Gemini API key to use AI detection features');
    }
  }, []);

  // Request camera permission
  useEffect(() => {
    const getPermission = async () => {
      if (!permission) {
        console.log('[VisionAid] Requesting camera permission');
        await requestPermission();
      }
    };
    getPermission();
  }, []);

  // Convert image to base64
  const imageToBase64 = async (uri) => {
    try {
      console.log('[VisionAid] Converting image to base64:', uri);
      const response = await fetch(uri);
      const blob = await response.blob();
      
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1]; // Remove data:image/jpeg;base64, prefix
          console.log('[VisionAid] Image converted to base64, length:', base64.length);
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('[VisionAid] Error converting image to base64:', error);
      throw error;
    }
  };

  // Call Gemini API for detection with enhanced multilingual support
  const callGeminiAPI = async (base64Image, mode, languageCode = null) => {
    console.log('[VisionAid] Calling Gemini API for mode:', mode, 'language:', languageCode);
    
    let prompt;
    
    if (mode === 'object') {
      // Get language name for the prompt
      const languageName = LANGUAGES.find(lang => lang.code === languageCode)?.name || 'English';
      prompt = `Analyze this image and identify all visible objects. List them clearly and concisely. Focus on the most prominent and recognizable items. Provide a comma-separated list of object names only, no descriptions or explanations. Respond in ${languageName}.`;
    } else {
      // Enhanced prompt for multilingual text detection
      prompt = `Carefully examine this image and extract ALL visible text content in any language. This includes:
        - Text in Tamil, Telugu, Malayalam, English, and other languages
        - Text on signs, labels, books, documents, screens
        - Handwritten text if legible
        - Text in different fonts, sizes, and orientations
        - Numbers, symbols, and alphanumeric content
        
        Requirements:
        1. Auto-detect the language/script of each text segment (Tamil, Telugu, Malayalam, English, etc.)
        2. Extract the text exactly as it appears in its original script/language
        3. If text is in multiple languages, separate each section with " | " (pipe symbol)
        4. Preserve line breaks and spacing where meaningful
        5. Include text even if partially visible or at angles
        6. If no readable text is found, respond with "No readable text detected"
        
        Return only the extracted text content in its original script/language, no descriptions or explanations.`;
    }

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 2048,
      }
    };

    try {
      console.log('[VisionAid] Sending request to Gemini API...');
      const startTime = Date.now();
      
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const responseTime = Date.now() - startTime;
      console.log('[VisionAid] Gemini API response received in', responseTime, 'ms');

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VisionAid] Gemini API error response:', response.status, errorText);
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('[VisionAid] Gemini API response:', JSON.stringify(data, null, 2));

      // Handle cases where the API returns an error
      if (data.error) {
        console.error('[VisionAid] Gemini API returned error:', data.error);
        throw new Error(data.error.message || 'API returned an error');
      }

      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const result = data.candidates[0].content.parts[0].text.trim();
        console.log('[VisionAid] Extracted result:', result);
        return result;
      } else if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.warn('[VisionAid] Prompt was blocked:', data.promptFeedback.blockReason);
        throw new Error(`Prompt blocked: ${data.promptFeedback.blockReason}`);
      } else {
        console.warn('[VisionAid] Unexpected API response structure');
        throw new Error('Unexpected API response structure');
      }
    } catch (error) {
      console.error('[VisionAid] Gemini API call failed:', error);
      setError(error.message);
      throw error;
    }
  };

  // Detect language from text content
  const detectLanguageFromText = (text) => {
    if (!text) return null;
    
    // Check for Tamil characters (Unicode range: U+0B80 to U+0BFF)
    if (/[ஂ-௺]/.test(text)) {
      return 'ta-IN';
    }
    // Check for Telugu characters (Unicode range: U+0C00 to U+0C7F)
    else if (/[ఀ-౿]/.test(text)) {
      return 'te-IN';
    }
    // Check for Malayalam characters (Unicode range: U+0D00 to U+0D7F)
    else if (/[ഀ-ൿ]/.test(text)) {
      return 'ml-IN';
    }
    // Default to English
    else {
      return 'en-IN';
    }
  };

  // Translate text using Gemini API
  const translateText = async (text, sourceLangCode, targetLangCode) => {
    if (!text || sourceLangCode === targetLangCode) {
      return text; // No translation needed
    }
    
    const sourceLang = LANGUAGES.find(lang => lang.code === sourceLangCode)?.name || 'English';
    const targetLang = LANGUAGES.find(lang => lang.code === targetLangCode)?.name || 'English';
    
    const prompt = `Translate the following text from ${sourceLang} to ${targetLang}. 
      Preserve the meaning exactly. Return only the translated text, no explanations or additional text.
      
      Text to translate: "${text}"`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 1024,
      }
    };
    
    try {
      console.log(`[VisionAid] Translating from ${sourceLang} to ${targetLang}`);
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VisionAid] Translation API error:', response.status, errorText);
        throw new Error(`Translation API Error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const translatedText = data.candidates[0].content.parts[0].text.trim();
        console.log('[VisionAid] Translation result:', translatedText);
        return translatedText;
      } else {
        console.warn('[VisionAid] Translation failed, returning original text');
        return text;
      }
    } catch (error) {
      console.error('[VisionAid] Translation failed:', error);
      // Return original text if translation fails
      return text;
    }
  };

  // Process detection queue (non-blocking)
  const processDetectionQueue = async () => {
    if (isProcessingRef.current || processingQueue.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const { imageUri, mode, timestamp } = processingQueue.current.shift();
    
    console.log('[VisionAid] Processing detection from queue, mode:', mode, 'timestamp:', timestamp);

    try {
      if (!isApiReady) {
        console.warn('[VisionAid] API not ready, using fallback');
        // Enhanced fallback data with more realistic text samples
        let mockResult, items;
        
        if (mode === 'object') {
          mockResult = ['Book', 'Phone', 'Cup', 'Table', 'Window'].slice(0, Math.floor(Math.random() * 3) + 1);
          items = mockResult;
          setDetectedItems(items);
          speakText(`Detected objects: ${items.join(', ')}`, selectedLanguage);
        } else {
          // Mock multilingual text based on selected language
          const languageSamples = {
            'en-IN': 'Welcome to VisionAid. This is English text.',
            'ta-IN': 'விஷன்ஏய்டுக்கு வரவேற்கிறோம். இது தமிழ் உரை.',
            'ml-IN': 'വിഷൻഎയ്ഡിലേക്ക് സ്വാഗതം. ഇത് മലയാളം വാചകമാണ്.',
            'te-IN': 'విజన్ఎయిడ్కు స్వాగతం. ఇది తెలుగు పాఠ్యం.'
          };
          
          mockResult = languageSamples[selectedLanguage] || languageSamples['en-IN'];
          items = [mockResult];
          setDetectedItems(items);
          speakText(`Text detected: ${mockResult}`, selectedLanguage);
        }
        
        return;
      }

      const base64Image = await imageToBase64(imageUri);
      
      if (mode === 'object') {
        // Object detection - use selected language
        const result = await callGeminiAPI(base64Image, mode, selectedLanguage);
        
        if (result && result !== 'No text detected' && result !== 'No readable text detected') {
          const items = result.split(',').map(item => item.trim()).filter(item => item.length > 0);
          console.log('[VisionAid] Object detection successful, items:', items);
          setDetectedItems(items);
          
          // Create appropriate speech text
          let speechText;
          if (items.length === 1) {
            speechText = `Detected object: ${items[0]}`;
          } else {
            speechText = `Detected objects: ${items.join(', ')}`;
          }
          
          speakText(speechText, selectedLanguage);
        } else {
          console.log('[VisionAid] No objects detected');
          setDetectedItems([]);
          speakText('No objects detected', selectedLanguage);
        }
      } else {
        // Text detection - detect language first
        const result = await callGeminiAPI(base64Image, mode);
        
        if (result && result !== 'No text detected' && result !== 'No readable text detected') {
          // Split text into segments
          const textSegments = result.split(' | ').map(segment => segment.trim()).filter(segment => segment.length > 0);
          
          if (textSegments.length === 0) {
            console.log('[VisionAid] No readable text detected');
            setDetectedItems([]);
            speakText('No readable text found', selectedLanguage);
            return;
          }
          
          // Detect language for each segment and translate if needed
          const processedSegments = [];
          let detectedLang = null;
          
          for (const segment of textSegments) {
            // Detect language of this segment
            const segmentLang = detectLanguageFromText(segment);
            setDetectedLanguage(segmentLang); // Update state for UI
            detectedLang = segmentLang; // Keep track of detected language
            
            // Translate if needed
            let processedText = segment;
            if (segmentLang && segmentLang !== selectedLanguage) {
              processedText = await translateText(segment, segmentLang, selectedLanguage);
            }
            
            processedSegments.push(processedText);
          }
          
          // Update detected items
          setDetectedItems(processedSegments);
          
          // Create speech text
          let speechText;
          if (detectedLang && detectedLang !== selectedLanguage) {
            const detectedLangName = LANGUAGES.find(lang => lang.code === detectedLang)?.name || 'Unknown';
            const selectedLangName = LANGUAGES.find(lang => lang.code === selectedLanguage)?.name || 'English';
            speechText = `Detected ${detectedLangName} text: ${processedSegments.join('. ')}. Translated to ${selectedLangName}.`;
          } else {
            speechText = `Text detected: ${processedSegments.join('. ')}`;
          }
          
          speakText(speechText, selectedLanguage);
        } else {
          console.log('[VisionAid] No readable text detected');
          setDetectedItems([]);
          speakText('No readable text found', selectedLanguage);
        }
      }
    } catch (error) {
      console.error('[VisionAid] Detection processing failed:', error);
      setDetectedItems([]);
      speakText(`Detection failed: ${error.message.includes('API') ? 'API connection issue' : 'Please try again'}`, selectedLanguage);
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
      
      // Process next item in queue if available
      if (processingQueue.current.length > 0) {
        setTimeout(processDetectionQueue, 100);
      }
    }
  };

  // Text-to-Speech function with language support and duplicate prevention
  const speakText = (text, languageCode) => {
    // Avoid repeating the same text
    if (lastSpoken === text) {
      console.log('[VisionAid] Skipping speech - same text as last spoken');
      return;
    }
    
    console.log('[VisionAid] Speaking text:', text, 'in language:', languageCode);
    
    // Enhanced speech settings for better accessibility
    const speechOptions = {
      rate: currentMode === 'text' ? 0.75 : 0.8, // Slower rate for text reading
      pitch: 1,
      volume: 1,
      language: languageCode, // Use selected language
    };
    
    // Stop any ongoing speech before starting new one
    Speech.stop();
    
    Speech.speak(text, speechOptions);
    setLastSpoken(text);
  };

  // Start detection
  const startDetection = async () => {
    console.log('[VisionAid] Starting detection');
    
    if (!permission || !permission.granted) {
      const permissionResult = await requestPermission();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Camera access is required for VisionAid to work');
        return;
      }
    }
   
    if (permission?.granted) {
      setIsActive(true);
      setLastDetectionTime(0); // Reset rate limiting
      setError(null); // Clear any previous errors
      setDetectedLanguage(null); // Reset detected language
      speakText(`${currentMode === 'object' ? 'Object detection' : 'Text reading'} mode activated. Point camera at ${currentMode === 'object' ? 'objects' : 'text in any language'} to begin detection.`, selectedLanguage);
      console.log('[VisionAid] Detection activated for mode:', currentMode);
    } else {
      Alert.alert('Permission Required', 'Camera access is required for VisionAid to work');
    }
  };

  // Stop detection
  const stopDetection = () => {
    console.log('[VisionAid] Stopping detection');
    setIsActive(false);
    setDetectedItems([]);
    setIsProcessing(false);
    setDetectedLanguage(null); // Reset detected language
    processingQueue.current = []; // Clear queue
    isProcessingRef.current = false;
    Speech.stop(); // Stop any ongoing speech
    speakText('VisionAid deactivated', selectedLanguage);
  };

  // Perform detection with enhanced image capture settings
  const performDetection = async () => {
    if (!isActive || !cameraRef.current) {
      console.log('[VisionAid] Detection skipped - inactive or no camera ref');
      return;
    }

    const now = Date.now();
    const timeSinceLastDetection = now - lastDetectionTime;
    
    if (timeSinceLastDetection < RATE_LIMIT_MS) {
      const waitTime = RATE_LIMIT_MS - timeSinceLastDetection;
      console.log('[VisionAid] Rate limited - waiting', waitTime, 'ms');
      return;
    }

    console.log('[VisionAid] Starting detection process');
    setIsProcessing(true);
    setLastDetectionTime(now);

    try {
      // Enhanced photo capture settings for better text recognition
      const photoOptions = {
        base64: false,
        quality: currentMode === 'text' ? 0.9 : 0.7, // Higher quality for text detection
        skipProcessing: false, // Enable processing for better text clarity
        exif: false,
      };
      
      const photo = await cameraRef.current.takePictureAsync(photoOptions);
      
      console.log('[VisionAid] Photo captured:', photo.uri);

      // Add to processing queue for non-blocking processing
      processingQueue.current.push({
        imageUri: photo.uri,
        mode: currentMode,
        timestamp: now
      });

      console.log('[VisionAid] Added to processing queue, queue length:', processingQueue.current.length);

      // Start processing if not already processing
      processDetectionQueue();

    } catch (error) {
      console.error('[VisionAid] Photo capture failed:', error);
      setIsProcessing(false);
      setError('Camera error: ' + error.message);
      speakText('Camera error, please try again', selectedLanguage);
    }
  };

  // Switch modes with enhanced feedback
  const switchMode = () => {
    const newMode = currentMode === 'object' ? 'text' : 'object';
    console.log('[VisionAid] Switching mode from', currentMode, 'to', newMode);
    setCurrentMode(newMode);
    setDetectedItems([]);
    setDetectedLanguage(null); // Reset detected language
    setLastDetectionTime(0); // Reset rate limiting
    processingQueue.current = []; // Clear queue when switching modes
    setError(null); // Clear errors when switching modes
    Speech.stop(); // Stop any ongoing speech
    
    const modeDescription = newMode === 'object' 
      ? 'Object detection mode. Point camera at objects to identify them.'
      : 'Text reading mode. Point camera at text in any language to read it aloud.';
    
    speakText(`Switched to ${modeDescription}`, selectedLanguage);
  };

  // Auto-detect every 6 seconds when active (accounting for 5s rate limit)
  useEffect(() => {
    let interval;
    if (isActive) {
      console.log('[VisionAid] Setting up auto-detection interval');
      interval = setInterval(() => {
        console.log('[VisionAid] Auto-detection triggered');
        performDetection();
      }, 6000); // 6 seconds to account for 5s rate limit + processing time
    }
    
    return () => {
      if (interval) {
        console.log('[VisionAid] Clearing auto-detection interval');
        clearInterval(interval);
      }
    };
  }, [isActive, currentMode, selectedLanguage]);

  // Debug: Log processing queue changes
  useEffect(() => {
    console.log('[VisionAid] Processing queue length changed:', processingQueue.current.length);
  }, [processingQueue.current.length]);

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera access denied. Please enable camera permissions in settings.</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.eyeIcon}>👁</Text>
          <Text style={styles.title}>VisionAid</Text>
        </View>
        <Text style={styles.subtitle}>
          AI-Powered Assistant for Visual Accessibility {isApiReady ? '🤖' : '⚠️ Mock Mode'}
        </Text>
      </View>

      {/* Language Selector */}
      <View style={styles.languageSelector}>
        <Text style={styles.languageLabel}>Select Language:</Text>
        <View style={styles.languageButtons}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              onPress={() => setSelectedLanguage(lang.code)}
              style={[
                styles.languageButton,
                selectedLanguage === lang.code && styles.languageButtonActive
              ]}
            >
              <Text style={styles.languageFlag}>{lang.flag}</Text>
              <Text style={[
                styles.languageButtonText,
                selectedLanguage === lang.code && styles.languageButtonTextActive
              ]}>
                {lang.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Detected Language Info (Text Mode Only) */}
      {currentMode === 'text' && detectedLanguage && (
        <View style={styles.detectedLanguageContainer}>
          <Text style={styles.detectedLanguageIcon}>🔤</Text>
          <Text style={styles.detectedLanguageText}>
            Detected: {LANGUAGES.find(lang => lang.code === detectedLanguage)?.name || 'Unknown Language'}
          </Text>
          {detectedLanguage !== selectedLanguage && (
            <Text style={styles.translationInfo}>
              Translating to {LANGUAGES.find(lang => lang.code === selectedLanguage)?.name}
            </Text>
          )}
        </View>
      )}

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)} style={styles.dismissErrorButton}>
            <Text style={styles.dismissErrorText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Mode Selector */}
      <View style={styles.modeSelector}>
        <TouchableOpacity
          onPress={() => currentMode !== 'object' && switchMode()}
          disabled={isProcessing}
          style={[
            styles.modeButton,
            currentMode === 'object' ? styles.modeButtonActive : styles.modeButtonInactive
          ]}
        >
          <Text style={styles.modeIcon}>🔍</Text>
          <Text style={[
            styles.modeButtonText,
            currentMode === 'object' ? styles.modeButtonTextActive : styles.modeButtonTextInactive
          ]}>
            Object Mode
          </Text>
        </TouchableOpacity>
       
        <TouchableOpacity
          onPress={() => currentMode !== 'text' && switchMode()}
          disabled={isProcessing}
          style={[
            styles.modeButton,
            currentMode === 'text' ? styles.modeButtonActive : styles.modeButtonInactive
          ]}
        >
          <Text style={styles.modeIcon}>📄</Text>
          <Text style={[
            styles.modeButtonText,
            currentMode === 'text' ? styles.modeButtonTextActive : styles.modeButtonTextInactive
          ]}>
            Text Mode
          </Text>
        </TouchableOpacity>
      </View>

      {/* Camera Section */}
      <View style={styles.cameraContainer}>
        {isActive ? (
          <View style={styles.cameraWrapper}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
            />
           
            {isProcessing && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color="#ffffff" />
                <Text style={styles.processingText}>
                  {currentMode === 'text' ? 'Reading multilingual text with' : 'Detecting objects with'} {isApiReady ? 'Gemini AI' : 'Mock Data'}...
                </Text>
              </View>
            )}
           
            {detectedItems.length > 0 && !isProcessing && (
              <View style={styles.detectionOverlay}>
                <Text style={styles.detectionLabel}>
                  {currentMode === 'object' ? '🔍 Detected Objects:' : '📄 Text Found:'}
                </Text>
                <Text style={styles.detectionResult} numberOfLines={currentMode === 'text' ? 4 : 2}>
                  {currentMode === 'text' ? detectedItems.join(' | ') : detectedItems.join(', ')}
                </Text>
              </View>
            )}

            {/* Rate Limit Indicator */}
            {(() => {
              const timeSinceLastDetection = Date.now() - lastDetectionTime;
              const remainingTime = Math.max(0, RATE_LIMIT_MS - timeSinceLastDetection);
              if (remainingTime > 0 && lastDetectionTime > 0) {
                return (
                  <View style={styles.rateLimitOverlay}>
                    <Text style={styles.rateLimitText}>
                      ⏳ Next detection in {Math.ceil(remainingTime / 1000)}s
                    </Text>
                  </View>
                );
              }
              return null;
            })()}
          </View>
        ) : (
          <View style={styles.cameraPlaceholder}>
            <Text style={styles.cameraPlaceholderIcon}>📷</Text>
            <Text style={styles.cameraPlaceholderText}>Tap "Start VisionAid" to begin</Text>
            <Text style={styles.cameraPlaceholderSubtext}>
              {currentMode === 'text' ? 'Multilingual text reading mode selected' : 'Object detection mode selected'}
            </Text>
          </View>
        )}
      </View>

      {/* Control Buttons */}
      <View style={styles.controlButtons}>
        {!isActive ? (
          <TouchableOpacity onPress={startDetection} style={styles.startButton}>
            <Text style={styles.startButtonIcon}>⚡</Text>
            <Text style={styles.startButtonText}>Start VisionAid</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.activeButtons}>
            <TouchableOpacity onPress={stopDetection} style={styles.stopButton}>
              <Text style={styles.buttonIcon}>🛑</Text>
              <Text style={styles.buttonText}>Stop</Text>
            </TouchableOpacity>
           
            <TouchableOpacity
              onPress={performDetection}
              disabled={isProcessing || (Date.now() - lastDetectionTime < RATE_LIMIT_MS)}
              style={[
                styles.detectButton, 
                (isProcessing || (Date.now() - lastDetectionTime < RATE_LIMIT_MS)) && styles.buttonDisabled
              ]}
            >
              <Text style={styles.buttonIcon}>🔄</Text>
              <Text style={styles.buttonText}>Detect Now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Detection Results */}
      <View style={styles.resultsContainer}>
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsIcon}>📊</Text>
          <Text style={styles.resultsTitle}>Detection Results</Text>
        </View>
       
        {detectedItems.length > 0 ? (
          <View style={styles.resultsList}>
            {detectedItems.map((item, index) => (
              <View key={index} style={styles.resultItem}>
                <Text style={[styles.resultItemText, currentMode === 'text' && styles.textResultItem]} numberOfLines={currentMode === 'text' ? 0 : 1}>
                  {item}
                </Text>
                <TouchableOpacity
                  onPress={() => speakText(item, selectedLanguage)}
                  style={styles.speakButton}
                >
                  <Text style={styles.speakButtonText}>🔊</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noResultsText}>
            {isActive
              ? `Point camera at ${currentMode === 'object' ? 'objects' : 'text in any language'} to detect...`
              : 'Start VisionAid to begin detection'
            }
          </Text>
        )}
      </View>

      {/* Status Information */}
      <View style={styles.statusContainer}>
        <View style={styles.statusItem}>
          <Text style={styles.statusIcon}>
            {currentMode === 'object' ? '🔍' : '📄'}
          </Text>
          <Text style={styles.statusLabel}>Current Mode</Text>
          <Text style={styles.statusValue}>{currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}</Text>
        </View>
       
        <View style={styles.statusItem}>
          <Text style={styles.statusIcon}>
            {isActive ? '🟢' : '🔴'}
          </Text>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusValue}>{isActive ? 'Active' : 'Inactive'}</Text>
        </View>

        <View style={styles.statusItem}>
          <Text style={styles.statusIcon}>
            {isApiReady ? '🤖' : '⚠️'}
          </Text>
          <Text style={styles.statusLabel}>AI Mode</Text>
          <Text style={styles.statusValue}>{isApiReady ? 'Gemini' : 'Mock'}</Text>
        </View>
      </View>

      {/* Last Spoken */}
      {lastSpoken && (
        <View style={styles.lastSpokenContainer}>
          <View style={styles.lastSpokenHeader}>
            <Text style={styles.lastSpokenIcon}>💬</Text>
            <Text style={styles.lastSpokenLabel}>Last Spoken:</Text>
          </View>
          <Text style={styles.lastSpokenText} numberOfLines={3}>"{lastSpoken}"</Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>VisionAid v2.0 - Talent Hunt 2025</Text>
        <Text style={styles.footerSubtitle}>Department of IT, EASWARI Engineering College</Text>
        <Text style={styles.footerEvent}>🏆 EVENTHRA Club Project Showcase</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  loadingText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 50,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    fontSize: 16,
    margin: 20,
  },
  permissionButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    alignSelf: 'center',
    marginTop: 16,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#4f46e5',
    padding: 16,
    paddingTop: 50,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  eyeIcon: {
    fontSize: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    textAlign: 'center',
    color: '#c7d2fe',
    marginTop: 4,
    fontSize: 14,
  },
  languageSelector: {
    backgroundColor: '#1f2937',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  languageLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  languageButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#4b5563',
  },
  languageButtonActive: {
    backgroundColor: '#059669',
  },
  languageFlag: {
    fontSize: 16,
  },
  languageButtonText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '500',
  },
  languageButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  detectedLanguageContainer: {
    backgroundColor: '#1e3a8a',
    margin: 16,
    padding: 12,
    borderRadius: 8,
    flexDirection: 'column',
    gap: 4,
  },
  detectedLanguageIcon: {
    fontSize: 18,
    textAlign: 'center',
  },
  detectedLanguageText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  translationInfo: {
    color: '#90cdf4',
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorContainer: {
    backgroundColor: '#fee2e2',
    margin: 16,
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  errorMessage: {
    color: '#b91c1c',
    flex: 1,
    fontSize: 14,
  },
  dismissErrorButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  dismissErrorText: {
    color: '#fff',
    fontSize: 12,
  },
  modeSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    padding: 16,
    backgroundColor: '#1f2937',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
  },
  modeButtonActive: {
    backgroundColor: '#059669',
  },
  modeButtonInactive: {
    backgroundColor: '#4b5563',
  },
  modeIcon: {
    fontSize: 20,
  },
  modeButtonText: {
    fontWeight: '600',
    fontSize: 16,
  },
  modeButtonTextActive: {
    color: '#fff',
  },
  modeButtonTextInactive: {
    color: '#d1d5db',
  },
  cameraContainer: {
    margin: 16,
    height: height * 0.3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  processingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    flexWrap: 'wrap',
  },
  detectionOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 8,
    padding: 12,
  },
  detectionLabel: {
    color: '#10b981',
    fontSize: 12,
    marginBottom: 4,
  },
  detectionResult: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  rateLimitOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.9)',
    borderRadius: 8,
    padding: 8,
  },
  rateLimitText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraPlaceholderIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  cameraPlaceholderText: {
    color: '#9ca3af',
    fontSize: 18,
    textAlign: 'center',
  },
  cameraPlaceholderSubtext: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  controlButtons: {
    alignItems: 'center',
    marginBottom: 16,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 25,
  },
  startButtonIcon: {
    fontSize: 20,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  activeButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
  },
  detectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
  },
  buttonDisabled: {
    backgroundColor: '#4b5563',
  },
  buttonIcon: {
    fontSize: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsContainer: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    margin: 16,
    padding: 16,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  resultsIcon: {
    fontSize: 20,
  },
  resultsTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  resultsList: {
    gap: 8,
  },
  resultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#374151',
    padding: 12,
    borderRadius: 8,
  },
  resultItemText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    flex: 1,
  },
  textResultItem: {
    fontSize: 16,
    lineHeight: 22,
  },
  speakButton: {
    padding: 8,
    borderRadius: 20,
    marginLeft: 8,
  },
  speakButtonText: {
    fontSize: 16,
  },
  noResultsText: {
    color: '#9ca3af',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
    fontSize: 16,
  },
  statusContainer: {
    flexDirection: 'row',
    gap: 12,
    margin: 16,
  },
  statusItem: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  statusLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 2,
  },
  statusValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  lastSpokenContainer: {
    backgroundColor: '#1e3a8a',
    borderColor: '#3b82f6',
    borderWidth: 1,
    borderRadius: 12,
    margin: 16,
    padding: 16,
  },
  lastSpokenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  lastSpokenIcon: {
    fontSize: 16,
  },
  lastSpokenLabel: {
    color: '#bfdbfe',
    fontSize: 14,
    fontWeight: '500',
  },
  lastSpokenText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  footer: {
    backgroundColor: '#1f2937',
    borderTopWidth: 1,
    borderTopColor: '#374151',
    padding: 16,
    alignItems: 'center',
  },
  footerTitle: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  footerSubtitle: {
    color: '#9ca3af',
    fontSize: 14,
  },
  footerEvent: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
});

export default VisionAidApp;