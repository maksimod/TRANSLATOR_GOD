// Translation service
import Config from './config.js';
import { debugLog } from './utils.js';

// Keep track of translation requests
let translationInProgress = {}; // Track if translation is currently in progress
let translationCache = new Map(); // Cache for translations to avoid duplicate requests
let partialTranslations = {}; // For storing partial translations to be shown in the UI
let lastApiRequestTime = 0; // Track last API request time for rate limiting
let activeTimers = {}; // Track active timers for each speaker
let lastTranslatedText = {}; // Track the last text we translated for each speaker
let lastProcessedTime = {}; // Track when we last processed text for each speaker

// Check if enough time has passed since the last translation
function hasTimePassedForTranslation(speakerId) {
  const now = Date.now();
  const lastTime = lastProcessedTime[speakerId] || 0;
  
  // If enough time has passed since last processing
  if (now - lastTime >= Config.SUBTITLE_PROCESSING_INTERVAL) {
    lastProcessedTime[speakerId] = now;
    return true;
  }
  
  return false;
}

/**
 * Translate text using OpenAI API
 * @param {string} speakerId - ID of the speaker
 * @param {string} text - Text to translate
 * @param {string} inputLang - Input language
 * @param {string} outputLang - Output language
 * @returns {Promise<string|null>} - Translated text or null if throttled
 */
async function translateText(speakerId, text, inputLang, outputLang) {
  // Don't translate if the text is too short
  if (text.length < 2) return text;
  
  // Create cache key
  const cacheKey = `${inputLang}:${outputLang}:${text}`;
  
  // Check cache first
  if (translationCache.has(cacheKey)) {
    const cachedTranslation = translationCache.get(cacheKey);
    debugLog(`Using cached translation for: ${text}`);
    
    // Update active speakers immediately with the cached translation
    updateActiveSpeakerTranslation(speakerId, cachedTranslation);
    
    return cachedTranslation;
  }

  // Check if we have previously translated text for this speaker
  const prevTranslatedText = lastTranslatedText[speakerId] || '';
  
  // If text hasn't changed, return previous translation
  if (text === prevTranslatedText && partialTranslations[speakerId]) {
    return partialTranslations[speakerId];
  }
  
  // Check if enough time has passed since last translation
  if (!hasTimePassedForTranslation(speakerId)) {
    debugLog(`Too soon to translate, waiting ${Config.SUBTITLE_PROCESSING_INTERVAL}ms: ${text}`);
    return partialTranslations[speakerId] || "Translating...";
  }

  // Rate limit API requests
  const now = Date.now();
  if (now - lastApiRequestTime < Config.API_RATE_LIMIT) {
    debugLog(`Rate limited, waiting ${Config.API_RATE_LIMIT - (now - lastApiRequestTime)}ms`);
    return partialTranslations[speakerId] || "Translating...";
  }

  // If there's already a translation in progress for this speaker,
  // return the current partial translation
  if (translationInProgress[speakerId]) {
    debugLog(`Translation already in progress for speaker`);
    return partialTranslations[speakerId] || "Translating...";
  }
  
  // Update the last translated text for this speaker
  lastTranslatedText[speakerId] = text;
  
  // Mark this translation as in progress
  translationInProgress[speakerId] = { text };
  
  try {
    debugLog(`Translating for ${speakerId}: ${text}`);
    
    // Always update UI with "Translating..." as a feedback to the user
    updateActiveSpeakerTranslation(speakerId, "Translating...");
    
    // Format proper request to API
    const requestBody = {
      model: Config.MODEL_NAME,
      messages: [
        {
          role: "system",
          content: `You are a translation assistant. Translate text from ${inputLang} to ${outputLang} concisely and accurately. Keep the translation direct and maintain the same style and tone.`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3 // Lower temperature for more consistent translations
    };
    
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      lastApiRequestTime = now;
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Config.OPENAI_API_KEY}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API response error: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Verify that the response has the expected structure
      if (!data || !data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        throw new Error("Invalid response structure from API");
      }
      
      const translatedText = data.choices[0].message.content.trim();
      
      // Add to cache
      translationCache.set(cacheKey, translatedText);
      
      // Update partial translations for this speaker
      partialTranslations[speakerId] = translatedText;
      
      // Update active speaker with the new translation
      updateActiveSpeakerTranslation(speakerId, translatedText);
      
      // Clear in-progress flag
      delete translationInProgress[speakerId];
      
      // Limit cache size to avoid memory leaks
      if (translationCache.size > 500) {
        // Delete oldest entries (first 100)
        const keysToDelete = Array.from(translationCache.keys()).slice(0, 100);
        keysToDelete.forEach(key => translationCache.delete(key));
      }
      
      debugLog(`Translation complete: ${translatedText.substring(0, 40)}...`);
      
      return translatedText;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    console.error("Translation error:", error);
    debugLog(`Translation error: ${error.message}`);
    
    // Clear in-progress flag
    delete translationInProgress[speakerId];
    
    // Return the last partial translation if we have one
    if (partialTranslations[speakerId]) {
      return partialTranslations[speakerId];
    }
    
    // For errors, return a temporary message
    const tempMsg = "Translating...";
    updateActiveSpeakerTranslation(speakerId, tempMsg);
    return tempMsg;
  }
}

/**
 * Update the active speaker's translation in real-time
 * @param {string} speakerId - The speaker ID
 * @param {string} translatedText - The translated text
 */
function updateActiveSpeakerTranslation(speakerId, translatedText) {
  // Get active speakers if available in window
  const getActiveSpeakers = window.getActiveSpeakers || function() { return {}; };
  const activeSpeakers = getActiveSpeakers();
  
  // Update translation if speaker is active
  if (activeSpeakers[speakerId] && activeSpeakers[speakerId].active) {
    // Only update if text is different to avoid unnecessary UI updates
    if (activeSpeakers[speakerId].translatedText !== translatedText) {
      activeSpeakers[speakerId].translatedText = translatedText;
      
      // Force UI update by explicitly triggering any available display update function
      if (window.forceDisplayUpdate && typeof window.forceDisplayUpdate === 'function') {
        window.forceDisplayUpdate(activeSpeakers);
      }
    }
  }
}

/**
 * Check API connection by making a simple request
 * @returns {Promise<boolean>} True if API is accessible
 */
async function checkApiConnection() {
  try {
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      // Make a simpler request to verify API access
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${Config.OPENAI_API_KEY}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        debugLog(`API check failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
        return false;
      }
      
      return true;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    debugLog(`API check error: ${error.message}`);
    return false;
  }
}

/**
 * Clear all active translation timers
 */
function clearTranslationTimers() {
  // Reset translation states
  translationInProgress = {}; // Clear in-progress flags
  lastTranslatedText = {}; // Clear last translated text
  
  // Clear all active timers
  Object.values(activeTimers).forEach(timer => {
    if (timer) clearTimeout(timer);
  });
  activeTimers = {};
}

/**
 * Get active timer for a specific speaker
 * @param {string} speakerId - The speaker ID
 * @param {string} type - The timer type
 * @returns {number|null} The timer ID or null if not found
 */
function getActiveTimerForSpeaker(speakerId, type) {
  return activeTimers[`${type}_${speakerId}`] || null;
}

/**
 * Set active timer for a specific speaker
 * @param {string} speakerId - The speaker ID
 * @param {string} type - The timer type
 * @param {number} timer - The timer ID
 */
function setActiveTimerForSpeaker(speakerId, type, timer) {
  // Clear existing timer first if it exists
  if (activeTimers[`${type}_${speakerId}`]) {
    clearTimeout(activeTimers[`${type}_${speakerId}`]);
  }
  
  activeTimers[`${type}_${speakerId}`] = timer;
}

/**
 * Clear active timer for a specific speaker
 * @param {string} speakerId - The speaker ID
 * @param {string} type - The timer type
 */
function clearActiveTimerForSpeaker(speakerId, type) {
  if (activeTimers[`${type}_${speakerId}`]) {
    clearTimeout(activeTimers[`${type}_${speakerId}`]);
    delete activeTimers[`${type}_${speakerId}`];
  }
}

export {
  translateText,
  checkApiConnection,
  clearTranslationTimers,
  getActiveTimerForSpeaker,
  setActiveTimerForSpeaker,
  clearActiveTimerForSpeaker
};
