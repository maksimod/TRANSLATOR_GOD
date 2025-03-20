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
        
        // Update the full text - use the newest, most complete text
        if (text.length > activeSpeakers[speakerId].fullText.length || hasContentChanged) {
          activeSpeakers[speakerId].fullText = text;
          lastFullTextBySpeaker[speakerId] = text;
          
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
 * @param {string} speakerId - Speaker ID
 * @param {object} utterance - Utterance object
 */
function updateTranslatedUtterancesMap(speakerId, utterance) {
  // Just replace the current utterance for this speaker
  translatedUtterances[speakerId] = utterance;
}

/**
 * Finalize a speech (mark it as complete)
 * @param {string} speakerId - ID of the speaker
 * @param {string} inputLang - Input language
 * @param {string} outputLang - Output language
 */
async function finalizeSpeech(speakerId, inputLang, outputLang) {
  if (!activeSpeakers[speakerId]) return;
  
  // Get the final active utterance
  const utterance = activeSpeakers[speakerId];
  
  // Cancel any pending translation
  if (translationTimers[speakerId]) {
    clearTimeout(translationTimers[speakerId]);
    delete translationTimers[speakerId];
  }
  
  // If we haven't translated it yet, try once more
  if (!utterance.translatedText || utterance.translatedText === "..." || utterance.translatedText === "Translating...") {
    const translatedText = await translateText(speakerId, utterance.fullText, inputLang, outputLang);
    if (translatedText) {
      utterance.translatedText = translatedText;
    } else {
      utterance.translatedText = "[Translation unavailable]";
    }
  }
  
  // Only add to finalized utterances if we're not currently clearing
  if (!isClearing) {
    // Create a final utterance object
    const finalUtterance = {
      id: utterance.utteranceId,
      speaker: utterance.speaker,
      speakerId: speakerId,
      original: utterance.fullText,
      translated: utterance.translatedText,
      timestamp: new Date().toLocaleTimeString(),
      active: false,
      avatar: utterance.avatar
    };
    
    // Update our map of translated utterances
    updateTranslatedUtterancesMap(speakerId, finalUtterance);
    
    // Log the complete translation
    debugLog(`Finalized speech: "${utterance.translatedText?.substring(0, 40) || 'n/a'}..."`);
    debugLog(`Finalized speech from ${utterance.speaker}: "${utterance.fullText.substring(0, 40)}..."`);
  }
  
  // Create new utterance ID for next time this speaker talks
  const newId = Date.now().toString();
  
  // Create a new object for future utterances from this speaker
  // This allows multiple utterances from the same speaker to be accumulated
  const speakerInfo = {
    speaker: utterance.speaker,
    fullText: "",
    lastTime: 0,
    translatedText: "",
    utteranceId: newId,
    active: false,
    avatar: utterance.avatar
  };
  
  // Keep the speaker reference with new ID and empty content
  activeSpeakers[speakerId] = speakerInfo;
  
  // Clear any related timers
  clearActiveTimerForSpeaker(speakerId, 'finalize');
  
  // Update the display
  forceDisplayUpdate();
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
 * Get translated utterances
 * @returns {Object} - Map of speaker IDs to their latest utterances
 */
function getTranslatedUtterances() {
  return translatedUtterances;
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