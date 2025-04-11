// Subtitle processing module
import Config from './config.js';
import { debugLog, getSpeakerId, isContinuationOfSpeech } from './utils.js';
import { 
  translateText, 
  clearActiveTimerForSpeaker, 
  setActiveTimerForSpeaker 
} from './translation-service.js';
import { updateTranslationsDisplay } from './popup-manager.js';

// Speech detection variables
let activeSpeakers = {}; // Map of active speakers and their current utterances
let knownSubtitles = new Set(); // Set of known subtitle texts to avoid duplicates
let translatedUtterances = {}; // Map of speaker ID to their latest utterance
let isClearing = false; // Flag to prevent clearing and adding simultaneously
let lastProcessedTime = 0; // Track when we last processed subtitles

let clearSubtitleData_delay = 500;

// Speaker identification cache
let lastFullTextBySpeaker = {}; // Track last complete text by speaker to avoid duplicates

// Timers for delaying translations
let translationTimers = {};

/**
 * Reset known subtitles to avoid processing past items
 */
function resetKnownSubtitles() {
  knownSubtitles.clear();
  lastFullTextBySpeaker = {}; // Reset last texts as well
  debugLog("Known subtitles reset");
}

/**
 * Enhanced speaker detection from Teams UI
 * @returns {Object} Speaker information with name and possible avatar URL
 */
function detectSpeaker() {
  try {
    let speakerName = "Unknown";
    let speakerAvatar = null;
    
    // Try multiple selectors to find the speaker
    const speakerSelectors = [
      // Primary Teams caption selector
      '[data-tid="closed-caption-activity-name"]',
      // Alternative selector for newer versions
      '.ts-captions-container .ts-captions-speaker',
      // Fallback for other versions
      '[aria-label*="caption"] .caption-speaker',
      '.caption-container .caption-speaker',
      // Extremely generic fallback - last resort
      '[class*="caption"] [class*="speaker"]'
    ];
    
    // Try each selector
    for (const selector of speakerSelectors) {
      const speakerElement = document.querySelector(selector);
      if (speakerElement && speakerElement.innerText.trim()) {
        speakerName = speakerElement.innerText.trim();
        break;
      }
    }
    
    // Try to find avatar (profile picture)
    const avatarSelectors = [
      // Various possible selectors for avatar images
      '[data-tid="closed-caption-activity-avatar"] img',
      '.ts-captions-container .ts-captions-avatar img',
      '[class*="avatar-image"]',
      '.call-participant-avatar img'
    ];
    
    for (const selector of avatarSelectors) {
      const avatarElement = document.querySelector(selector);
      if (avatarElement && avatarElement.src) {
        speakerAvatar = avatarElement.src;
        break;
      }
    }
    
    // If we still don't have a speaker name, try looking at data attributes
    if (speakerName === "Unknown") {
      const possibleElements = document.querySelectorAll('[aria-label*="is speaking"], [data-tid*="participant"]');
      for (const el of possibleElements) {
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.includes('speaking')) {
          // Extract name from aria-label like "John Doe is speaking"
          const match = ariaLabel.match(/(.*?)\s+is speaking/i);
          if (match && match[1]) {
            speakerName = match[1].trim();
            break;
          }
        }
        
        // Check data attributes that might contain speaker info
        const dataTid = el.getAttribute('data-tid');
        if (dataTid && dataTid.includes('participant')) {
          // The element itself might have the name or a child element might
          if (el.innerText && el.innerText.trim()) {
            speakerName = el.innerText.trim();
            break;
          }
          
          // Check for name in children
          const nameEl = el.querySelector('[data-tid*="name"], [class*="name"]');
          if (nameEl && nameEl.innerText.trim()) {
            speakerName = nameEl.innerText.trim();
            break;
          }
        }
      }
    }
    
    // Clean up speaker name (remove role indicators)
    speakerName = speakerName
      .replace(/\(organizer\)/i, '')
      .replace(/\(presenter\)/i, '')
      .replace(/\(attendee\)/i, '')
      .replace(/\(guest\)/i, '')
      .trim();
    
    return { name: speakerName, avatar: speakerAvatar };
  } catch (error) {
    console.error("Error detecting speaker:", error);
    return { name: "Unknown", avatar: null };
  }
}

/**
 * Process subtitles found in the DOM
 * @param {boolean} isTranslationActive - Whether translation is active
 * @param {string} inputLang - Input language
 * @param {string} outputLang - Output language
 */
function processSubtitles(isTranslationActive, inputLang, outputLang) {
  // Skip processing if translation is inactive or we're currently clearing
  if (!isTranslationActive || isClearing) {
    return;
  }

  // Select all subtitle containers - try multiple selectors to be more robust
  const subtitleSelectors = [
    'span[dir="auto"][data-tid="closed-caption-text"]',
    '.ts-captions-container .ts-captions-text',
    '.caption-text',
    '[class*="caption"] [class*="text"]'
  ];
  
  let subtitleContainers = [];
  for (const selector of subtitleSelectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      subtitleContainers = elements;
      break;
    }
  }

  if (subtitleContainers.length === 0) {
    return;
  }

  try {
    // Use a map to collect unique text by speaker
    const currentTexts = new Map();
    
    // Detect current speaker first
    const { name: speakerName, avatar: speakerAvatar } = detectSpeaker();
    const speakerId = getSpeakerId(speakerName);
    
    // Process each subtitle container
    for (const subtitleContainer of subtitleContainers) {
      const text = subtitleContainer.innerText.trim();
      
      // Skip if the text is empty or already processed recently
      if (!text || knownSubtitles.has(text)) {
        continue;
      }
      
      // Add to the current texts map
      currentTexts.set(speakerId, {
        text,
        speakerName,
        speakerAvatar
      });
      
      // Add to known subtitles set to avoid duplicates
      knownSubtitles.add(text);
    }
    
    // Now process each unique speaker's text
    for (const [speakerId, data] of currentTexts.entries()) {
      const { text, speakerName, speakerAvatar } = data;
      
      // Skip if this text is identical to the last complete utterance for this speaker
      if (lastFullTextBySpeaker[speakerId] === text) {
        continue;
      }
      
      debugLog(`Detected subtitle from ${speakerName}: "${text}"`);
      
      // Check if this is a continued speech or a new one
      if (activeSpeakers[speakerId]) {
        // Update the time of the last segment
        activeSpeakers[speakerId].lastTime = Date.now();
        
        const hasContentChanged = activeSpeakers[speakerId].fullText !== text;
        
        // Improved continuation detection: Check if the new text is a continuation
        // of the existing text or if it contains the existing text
        let isContinuation = false;
        const existingText = activeSpeakers[speakerId].fullText;
        
        // Check if new text contains most of the old text (80% similarity threshold)
        // or if old text contains most of the new text
        if (existingText && text) {
          // Check if either text contains a significant portion of the other
          if (existingText.includes(text.substring(0, Math.floor(text.length * 0.8))) ||
              text.includes(existingText.substring(0, Math.floor(existingText.length * 0.8)))) {
            isContinuation = true;
          }
          
          // If texts start with the same words (first 5 words match), consider it a continuation
          const existingWords = existingText.split(' ');
          const newWords = text.split(' ');
          
          if (existingWords.length >= 5 && newWords.length >= 5) {
            const existingStart = existingWords.slice(0, 5).join(' ');
            const newStart = newWords.slice(0, 5).join(' ');
            
            if (existingStart === newStart) {
              isContinuation = true;
            }
          }
        }
        
        // Update the full text - use the newest, most complete text
        // But preserve continuation logic
        if (isContinuation || text.length > activeSpeakers[speakerId].fullText.length || hasContentChanged) {
          // For continuation, we need to be smarter about how we update the text
          if (isContinuation && text.length < existingText.length) {
            // Keep the existing, longer text
            // Don't update fullText at all
          } else {
            activeSpeakers[speakerId].fullText = text;
            lastFullTextBySpeaker[speakerId] = text;
          }
          
          // Also update avatar if available
          if (speakerAvatar && !activeSpeakers[speakerId].avatar) {
            activeSpeakers[speakerId].avatar = speakerAvatar;
          }
          
          // If content changed, force UI update to show "Translating..." initially
          if (hasContentChanged) {
            updateTranslationsDisplay(translatedUtterances, activeSpeakers);
          }
        }
        
        // Reset the finalization timer
        clearActiveTimerForSpeaker(speakerId, 'finalize');
        
        // Set a new finalization timer
        setActiveTimerForSpeaker(speakerId, 'finalize', setTimeout(() => {
          finalizeSpeech(speakerId, inputLang, outputLang);
        }, Config.SPEECH_SEGMENT_TIMEOUT));
        
        // Translate immediately without delay
        translateAndUpdateUtterance(speakerId, inputLang, outputLang);
      } else {
        // This is a new speech
        activeSpeakers[speakerId] = {
          speaker: speakerName,
          fullText: text,
          lastTime: Date.now(),
          translatedText: "Translating...",
          utteranceId: Date.now().toString(),
          active: true,
          avatar: speakerAvatar
        };
        
        lastFullTextBySpeaker[speakerId] = text;
        
        // Set a finalization timer
        setActiveTimerForSpeaker(speakerId, 'finalize', setTimeout(() => {
          finalizeSpeech(speakerId, inputLang, outputLang);
        }, Config.SPEECH_SEGMENT_TIMEOUT));
        
        // Translate immediately without delay
        translateAndUpdateUtterance(speakerId, inputLang, outputLang);
        
        // Immediately update display to show "Translating..." for this new speaker
        updateTranslationsDisplay(translatedUtterances, activeSpeakers);
      }
    }
    
    // Update the display if we processed anything
    if (currentTexts.size > 0) {
      forceDisplayUpdate();
    }
  } catch (error) {
    console.error("Error processing subtitles:", error);
    debugLog(`Subtitle processing error: ${error.message}`);
  }
}

/**
 * Force update displays
 */
function forceDisplayUpdate() {
  // Update popup display only
  updateTranslationsDisplay(translatedUtterances, activeSpeakers);
}

// Expose for use by translation service
window.forceDisplayUpdate = forceDisplayUpdate;

/**
 * Schedule translation with delay
 * @param {string} speakerId - Speaker ID
 * @param {string} inputLang - Source language
 * @param {string} outputLang - Target language
 */
function scheduleTranslation(speakerId, inputLang, outputLang) {
  // Cancel previous scheduled translation
  if (translationTimers[speakerId]) {
    clearTimeout(translationTimers[speakerId]);
  }
  
  // For immediate UI feedback, set a placeholder if there's no translation yet
  if (activeSpeakers[speakerId] && 
      (!activeSpeakers[speakerId].translatedText || 
       activeSpeakers[speakerId].translatedText === "..." ||
       activeSpeakers[speakerId].translatedText === "Translating...")) {
    activeSpeakers[speakerId].translatedText = "Translating...";
    // Update display to show the "Translating..." message
    forceDisplayUpdate();
  }
  
  // Schedule new translation with throttle delay
  translationTimers[speakerId] = setTimeout(() => {
    translateAndUpdateUtterance(speakerId, inputLang, outputLang);
    delete translationTimers[speakerId];
  }, Config.TRANSLATION_THROTTLE);
}

/**
 * Translate and update an active utterance
 * @param {string} speakerId - ID of the speaker
 * @param {string} inputLang - Input language
 * @param {string} outputLang - Output language
 */
async function translateAndUpdateUtterance(speakerId, inputLang, outputLang) {
  if (!activeSpeakers[speakerId]) return;
  
  const utterance = activeSpeakers[speakerId];
  const textToTranslate = utterance.fullText;

  debugLog(`Translating for ${speakerId}: ${textToTranslate.substring(0, 40)}...`);
  
  try {
    // Translate the text
    const translatedText = await translateText(speakerId, textToTranslate, inputLang, outputLang);
    
    // If this speaker is still active
    if (activeSpeakers[speakerId]) {
      // Set the translated text - even if partial or incomplete
      if (translatedText && translatedText !== activeSpeakers[speakerId].translatedText) {
        activeSpeakers[speakerId].translatedText = translatedText;
        
        // Log the translation
        debugLog(`Translation update: ${(translatedText || "").substring(0, 40)}...`);
        
        // Update our map of translated utterances with current (possibly partial) translation
        updateTranslatedUtterancesMap(speakerId, {
          id: activeSpeakers[speakerId].utteranceId,
          speaker: activeSpeakers[speakerId].speaker,
          speakerId: speakerId,
          original: activeSpeakers[speakerId].fullText,
          translated: translatedText,
          timestamp: new Date().toLocaleTimeString(),
          active: true,
          avatar: activeSpeakers[speakerId].avatar
        });
        
        // Force update of display
        forceDisplayUpdate();
      }
    }
  } catch (error) {
    console.error("Error in translateAndUpdateUtterance:", error);
    // If translation failed, don't stop trying - schedule another attempt
    if (activeSpeakers[speakerId] && activeSpeakers[speakerId].active) {
      translationTimers[speakerId] = setTimeout(() => {
        translateAndUpdateUtterance(speakerId, inputLang, outputLang);
        delete translationTimers[speakerId];
      }, Config.TRANSLATION_THROTTLE);
    }
  }
}

/**
 * Update the map of translated utterances
 * @param {string} speakerId - ID of the speaker
 * @param {Object} utterance - The utterance to add
 */
function updateTranslatedUtterancesMap(speakerId, utterance) {
  // Initialize array for this speaker if it doesn't exist
  if (!translatedUtterances[speakerId]) {
    translatedUtterances[speakerId] = [];
  }
  
  // Check if this utterance ID already exists (to avoid duplicates)
  const existingIndex = translatedUtterances[speakerId].findIndex(u => u.utteranceId === utterance.utteranceId);
  
  if (existingIndex !== -1) {
    // Update existing utterance
    translatedUtterances[speakerId][existingIndex] = {
      ...translatedUtterances[speakerId][existingIndex],
      ...utterance,
      lastUpdated: Date.now()
    };
  } else {
    // Add a timestamp to the utterance
    const timestampedUtterance = {
      ...utterance,
      timestamp: new Date().toLocaleTimeString(),
      lastUpdated: Date.now()
    };
    
    // Add to the array for this speaker
    translatedUtterances[speakerId].push(timestampedUtterance);
    
    // Cap the array size to avoid memory issues
    const maxUtterances = Config.MAX_STORED_UTTERANCES || 10;
    if (translatedUtterances[speakerId].length > maxUtterances) {
      translatedUtterances[speakerId] = translatedUtterances[speakerId].slice(-maxUtterances);
    }
  }
  
  // After any update to the utterances map, check for and fix any inconsistencies
  validateUtterancesMap();
}

/**
 * Validate and fix inconsistencies in the utterances map
 */
function validateUtterancesMap() {
  try {
    // Iterate through all speakers in the map
    for (const speakerId in translatedUtterances) {
      if (!translatedUtterances[speakerId] || !Array.isArray(translatedUtterances[speakerId])) {
        // Fix: convert non-array values to arrays
        if (translatedUtterances[speakerId] && typeof translatedUtterances[speakerId] === 'object') {
          // Convert single object to array
          translatedUtterances[speakerId] = [translatedUtterances[speakerId]];
        } else {
          // Reset to empty array if invalid
          translatedUtterances[speakerId] = [];
        }
      }
      
      // Ensure no duplicates by utteranceId
      const utteranceIds = new Set();
      translatedUtterances[speakerId] = translatedUtterances[speakerId].filter(utterance => {
        if (!utterance || !utterance.utteranceId) return false;
        
        if (utteranceIds.has(utterance.utteranceId)) {
          return false; // Skip duplicates
        }
        
        utteranceIds.add(utterance.utteranceId);
        return true;
      });
      
      // Sort by lastUpdated or timestamp (most recent first)
      translatedUtterances[speakerId].sort((a, b) => {
        const timeA = a.lastUpdated || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.lastUpdated || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeB - timeA;
      });
    }
  } catch (error) {
    console.error("Error validating utterances map:", error);
    debugLog(`Error validating utterances map: ${error.message}`);
  }
}

/**
 * Finalize a speech segment, marking it as complete
 * @param {string} speakerId - ID of the speaker
 * @param {string} inputLang - Input language
 * @param {string} outputLang - Output language
 */
async function finalizeSpeech(speakerId, inputLang, outputLang) {
  // Skip if the speaker is not active or if we're currently clearing
  if (!activeSpeakers[speakerId] || isClearing) {
    return;
  }
  
  try {
    debugLog(`Finalizing speech for ${speakerId}: "${activeSpeakers[speakerId].fullText}"`);
    
    // Get the current utterance
    const currentUtterance = activeSpeakers[speakerId];
    
    // Check if this utterance is too long (exceeding max length)
    // If so, finalize the current portion but don't mark as inactive
    const maxLength = Config.MAX_SPEECH_SEGMENT_LENGTH || 1000;
    const isExcessivelyLong = currentUtterance.fullText.length > maxLength;
    
    // Only do a final translation if needed
    if (isExcessivelyLong || !currentUtterance.translatedText || currentUtterance.translatedText === "Translating...") {
      // Do a final translation
      const finalText = await translateText(
        speakerId,
        currentUtterance.fullText,
        inputLang,
        outputLang
      );
      
      // Update the translated text
      currentUtterance.translatedText = finalText;
    }
    
    // If the text is excessively long, truncate it for performance but keep the speaker active
    if (isExcessivelyLong) {
      // Create a new utterance ID for the next segment
      const newUtteranceId = Date.now().toString();
      
      // Store the current utterance in the translated utterances map
      updateTranslatedUtterancesMap(speakerId, {
        ...currentUtterance,
        active: false // Mark as inactive to show it's done
      });
      
      // Keep the speaker active but start a fresh utterance
      // Important: retain the original speaker information
      activeSpeakers[speakerId] = {
        speaker: currentUtterance.speaker,
        fullText: "", // Start fresh for the next segment
        lastTime: Date.now(),
        translatedText: "Continuing...",
        utteranceId: newUtteranceId,
        active: true,
        avatar: currentUtterance.avatar
      };
      
      // Force a display update
      updateTranslationsDisplay(translatedUtterances, activeSpeakers);
      
      // Don't finalize any further
      return;
    }
    
    // For normal utterances (not excessively long), proceed with finalization
    updateTranslatedUtterancesMap(speakerId, {
      ...currentUtterance,
      active: false
    });
    
    // Remove from active speakers (but only if we have a valid translation to show)
    if (currentUtterance.translatedText && currentUtterance.translatedText !== "Translating...") {
      delete activeSpeakers[speakerId];
    }
    
    // Update UI
    updateTranslationsDisplay(translatedUtterances, activeSpeakers);
  } catch (error) {
    console.error("Error finalizing speech:", error);
    debugLog(`Error finalizing speech: ${error.message}`);
  }
}

/**
 * Clear all subtitle data
 */
function clearSubtitleData() {
  isClearing = true; // Set clearing flag
  
  try {
    // Clear data structures
    translatedUtterances = {};
    
    // Finalize any active speakers
    const activeIds = Object.keys(activeSpeakers);
    for (const speakerId of activeIds) {
      clearActiveTimerForSpeaker(speakerId, 'finalize');
      delete activeSpeakers[speakerId];
    }
    
    // Clear translation timers
    for (const speakerId in translationTimers) {
      clearTimeout(translationTimers[speakerId]);
      delete translationTimers[speakerId];
    }
    
    // Clear other data structures
    knownSubtitles.clear();
    lastFullTextBySpeaker = {};
    
    // Update display with empty data
    forceDisplayUpdate();
  } finally {
    // Always reset the clearing flag
    setTimeout(() => {
      isClearing = false;
    }, clearSubtitleData_delay); // Short delay to prevent race conditions
  }
}

/**
 * Get active speakers
 * @returns {Object} - Map of active speakers
 */
function getActiveSpeakers() {
  return activeSpeakers;
}

/**
 * Get a map of all translated utterances
 * @returns {Object} Map of speaker IDs to arrays of translated utterances
 */
function getTranslatedUtterances() {
  // Return a deep copy to avoid external modifications
  const copy = {};
  
  for (const speakerId in translatedUtterances) {
    if (translatedUtterances[speakerId] && Array.isArray(translatedUtterances[speakerId])) {
      copy[speakerId] = [...translatedUtterances[speakerId]];
    } else if (translatedUtterances[speakerId]) {
      // Handle case where it might still be a single object (for backward compatibility)
      copy[speakerId] = [translatedUtterances[speakerId]];
    } else {
      copy[speakerId] = [];
    }
  }
  
  return copy;
}

// Create a debounced version of processSubtitles
let debounceTimer;
function debounceProcessSubtitles(isTranslationActive, inputLang, outputLang) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processSubtitles(isTranslationActive, inputLang, outputLang);
  }, Config.DEBOUNCE_DELAY);
}

// Expose getActiveSpeakers globally so it can be used by translation service
window.getActiveSpeakers = getActiveSpeakers;

export {
  processSubtitles,
  debounceProcessSubtitles,
  clearSubtitleData,
  getActiveSpeakers,
  getTranslatedUtterances,
  resetKnownSubtitles
};