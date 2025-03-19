// Utility functions
import Config from './config.js';

// Debug logs container
let debugLogs = [];

/**
 * Add a debug log entry
 * @param {string} message - Log message
 */
function debugLog(message) {
  const timestamp = new Date().toISOString().substr(11, 8);
  const logEntry = `${timestamp}: ${message}`;
  debugLogs.push(logEntry);
  
  // Keep log size manageable
  if (debugLogs.length > Config.MAX_DEBUG_LOGS) {
    debugLogs.shift();
  }
  
  console.log(logEntry);
  
  // If there's a function to update popup logs, call it
  if (typeof window.updateDebugLogs === 'function') {
    try {
      window.updateDebugLogs();
    } catch (e) {
      // Ignore errors when updating debug logs
    }
  }
}

/**
 * Generate a unique ID for a speaker
 * @param {string} speakerName - The name of the speaker
 * @returns {string} - A unique ID
 */
function getSpeakerId(speakerName) {
  return `speaker_${speakerName.replace(/[^a-z0-9]/gi, '_')}`;
}

/**
 * Check if a text is likely a continuation of current speech
 * @param {object} activeSpeakers - Map of active speakers
 * @param {string} speaker - Speaker ID
 * @param {string} text - New text segment
 * @returns {boolean} - True if it's likely a continuation
 */
function isContinuationOfSpeech(activeSpeakers, speaker, text) {
  // If there's no active speech for this speaker, it's not a continuation
  if (!activeSpeakers[speaker] || !activeSpeakers[speaker].lastTime) {
    return false;
  }
  
  // If too much time has passed, it's not a continuation
  const timeSinceLastSegment = Date.now() - activeSpeakers[speaker].lastTime;
  if (timeSinceLastSegment > Config.SPEECH_SEGMENT_TIMEOUT) {
    return false;
  }
  
  // Simple heuristic: if the new text starts with lowercase and the previous doesn't end with punctuation
  const lastSegment = activeSpeakers[speaker].segments[activeSpeakers[speaker].segments.length - 1];
  const lastChar = lastSegment[lastSegment.length - 1];
  const isPunctuation = ['.', '!', '?', ':', ';'].includes(lastChar);
  const startsWithLowerCase = text.length > 0 && text[0] === text[0].toLowerCase() && text[0] !== text[0].toUpperCase();
  
  // If previous segment doesn't end with punctuation and new segment starts with lowercase,
  // it's likely a continuation
  if (!isPunctuation && startsWithLowerCase) {
    return true;
  }
  
  return false;
}

// Export all debugLogs for access from other modules
function getDebugLogs() {
  return debugLogs;
}

// Clear debug logs
function clearDebugLogs() {
  debugLogs = [];
}

export {
  debugLog,
  getSpeakerId,
  isContinuationOfSpeech,
  getDebugLogs,
  clearDebugLogs
};