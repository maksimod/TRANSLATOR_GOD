// Main content script
import Config from './config.js';
import { debugLog, clearDebugLogs } from './utils.js';
import { 
  clearTranslationTimers,
  checkApiConnection
} from './translation-service.js';
import { 
  openTranslationsWindow,
  updateTranslationsDisplay,
  setTranslationStatus,
  stopPopupCheck,
  closePopupWindow
} from './popup-manager.js';
import {
  debounceProcessSubtitles,
  clearSubtitleData,
  getActiveSpeakers,
  getTranslatedUtterances,
  resetKnownSubtitles
} from './subtitle-processor.js';


const update_time = 1000;
const UPDATE_PERIOD = 250;

// Wrap the entire script in a self-executing function to avoid global scope pollution
(async function () {
  // Check if the script has already run
  if (window.hasTranslationScriptRun) return;
  window.hasTranslationScriptRun = true; // Mark the script as run

  // Variables to store user preferences
  let inputLang = Config.DEFAULT_INPUT_LANG;
  let outputLang = Config.DEFAULT_OUTPUT_LANG;
  let isTranslationActive = false;
  let displayMode = 'popup'; // Only 'popup' mode is now supported
  
  // Reference to the MutationObserver
  let observer = null;
  
  // Keep track of connection status
  let connectionFailed = false;
  let connectionRetryCount = 0;
  const MAX_CONNECTION_RETRIES = 3;
  
  // Expose the clearAllTranslations function to the window for use by the popup
  window.clearAllTranslations = function() {
    clearAllTranslations();
  };
  
  // Expose isTranslationActive for popup checks
  Object.defineProperty(window, 'isTranslationActive', {
    get: function() {
      return isTranslationActive;
    }
  });

  // Function to clear all translations and associated data
  function clearAllTranslations() {
    clearSubtitleData();
    clearDebugLogs();
    clearTranslationTimers();
    
    debugLog("All translations cleared");
  }
  
  // Function to verify API key and connectivity
  async function verifyConnection() {
    try {
      debugLog("Verifying API connection...");
      
      const connectionOk = await checkApiConnection();
      
      if (!connectionOk) {
        throw new Error("API connection failed");
      }
      
      debugLog("API connection verified successfully");
      connectionFailed = false;
      connectionRetryCount = 0;
      return true;
    } catch (error) {
      console.error("API connection error:", error);
      debugLog(`API connection error: ${error.message}`);
      
      connectionFailed = true;
      connectionRetryCount++;
      
      if (connectionRetryCount >= MAX_CONNECTION_RETRIES) {
        debugLog("Max connection retries reached. Stopping translation.");
        stopTranslation();
        
        // Show alert only if we're in an active tab
        if (document.visibilityState === 'visible') {
          setTimeout(() => {
            alert("Failed to connect to translation API. Please check your API key or try again later.");
          }, 100);
        }
      }
      
      return false;
    }
  }

  // Function to start translation
  async function startTranslation() {
    if (isTranslationActive) {
      return { status: "success" };
    }
    
    // Reset known subtitles when starting to avoid translating old ones
    resetKnownSubtitles();
    
    // Verify API connection first
    const connectionValid = await verifyConnection();
    if (!connectionValid) {
      return { 
        status: "error", 
        message: "Failed to connect to translation API. Please check your API key or try again later."
      };
    }
    
    isTranslationActive = true;
    
    debugLog(`Starting translation with input: ${inputLang}, output: ${outputLang}, display: ${displayMode}`);
    
    // Initialize popup display - ВАЖНО: открывает перемещаемое окно перевода
    openTranslationsWindow(updateTranslationsDisplay);
    setTranslationStatus(true);
    
    // Only observe the caption container instead of the entire body
    const findCaptionContainer = () => {
      // Try to find the caption container element
      const possibleContainers = [
        document.querySelector('[role="dialog"][aria-label*="caption"], [data-tid="meetup-captions-container"]'),
        document.querySelector('[data-tid="closed-caption-container"]'),
        document.querySelector('.cc-container'),
        document.querySelector('.ts-captions-container'),
        document.querySelector('[class*="caption-container"]')
      ];
      
      return possibleContainers.find(el => el);
    };
    
    const captionContainer = findCaptionContainer();
    
    // Create a new observer if it doesn't exist
    if (!observer) {
      observer = new MutationObserver(() => {
        debounceProcessSubtitles(isTranslationActive, inputLang, outputLang);
      });
      
      // Set observation options - only monitor what we need
      const observerOptions = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: false
      };
      
      // If we found a caption container, observe only that
      if (captionContainer) {
        debugLog(`Found caption container, observing specifically`);
        observer.observe(captionContainer, observerOptions);
      } else {
        // Fallback to observing the body, but with more limited scope
        debugLog(`No caption container found, observing body`);
        observer.observe(document.body, observerOptions);
      }
    }
    
    // Add a safety check to periodically ensure everything is still working
    startSafetyChecks();
    
    // Force an immediate update
    setTimeout(() => {
      updateTranslationsDisplay(getTranslatedUtterances(), getActiveSpeakers());
    }, update_time);
    
    return { status: "success" };
  }
  
  // Safety check timer
  let safetyCheckTimer = null;
  
  // Start periodic safety checks
  function startSafetyChecks() {
    if (safetyCheckTimer) {
      clearInterval(safetyCheckTimer);
    }
    
    safetyCheckTimer = setInterval(() => {
      if (isTranslationActive) {
        // Make sure the observer is still active
        if (observer && !observer.takeRecords) {
          debugLog("Observer appears to be inactive, reconnecting...");
          
          // Recreate the observer
          observer.disconnect();
          observer = new MutationObserver(() => {
            debounceProcessSubtitles(isTranslationActive, inputLang, outputLang);
          });
          
          // Find caption container again using the improved selector list
          const captionContainer = findCaptionContainer();
          
          // Reattach it
          if (captionContainer) {
            observer.observe(captionContainer, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: false
            });
          } else {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: false
            });
          }
        }
        
        // Check for any recent translation failures
        if (connectionFailed) {
          // Try to reconnect
          verifyConnection();
        }
        
        // Update the translations display to make sure it's in sync
        updateTranslationsDisplay(
          getTranslatedUtterances(),
          getActiveSpeakers()
        );
      }
    }, Config.OBSERVER_UPDATE_INTERVAL); // Check every 30 seconds
  }
  
  // Function to stop translation
  function stopTranslation() {
    if (isTranslationActive) {
      isTranslationActive = false;
      
      debugLog("Stopping translation");
      
      // Disconnect the observer
      if (observer) {
        observer.disconnect();
      }
      
      // Clear all translation timers
      clearTranslationTimers();
      
      // Stop popup check and cleanup
      stopPopupCheck();
      setTranslationStatus(false);
      
      // Stop safety checks
      if (safetyCheckTimer) {
        clearInterval(safetyCheckTimer);
        safetyCheckTimer = null;
      }
      
      return { status: "success" };
    }
    
    return { status: "error", message: "Translation not active" };
  }
  
  // Helper function to find caption container
  function findCaptionContainer() {
    // Try to find the caption container element
    const possibleContainers = [
      document.querySelector('[role="dialog"][aria-label*="caption"], [data-tid="meetup-captions-container"]'),
      document.querySelector('[data-tid="closed-caption-container"]'),
      document.querySelector('.cc-container'),
      document.querySelector('.ts-captions-container'),
      document.querySelector('[class*="caption-container"]')
    ];
    
    return possibleContainers.find(el => el);
  }
  
  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "startTranslation") {
      // Update language settings
      inputLang = message.inputLang || Config.DEFAULT_INPUT_LANG;
      outputLang = message.outputLang || Config.DEFAULT_OUTPUT_LANG;
      
      // We only support popup mode now
      displayMode = 'popup';
      
      // Start translation
      startTranslation().then(result => {
        sendResponse(result);
      }).catch(error => {
        console.error("Error starting translation:", error);
        sendResponse({ status: "error", message: error.message });
      });
      
      return true; // Indicates we'll respond asynchronously
    } else if (message.action === "stopTranslation") {
      // Stop translation
      const result = stopTranslation();
      sendResponse(result);
      return true;
    } else if (message.action === "checkStatus") {
      // Return current status
      sendResponse({
        isActive: isTranslationActive,
        inputLang: inputLang,
        outputLang: outputLang,
        displayMode: displayMode
      });
      return true;
    } else if (message.action === "setDisplayMode") {
      // We only support popup mode now
      displayMode = 'popup';
      
      // Update popup if translation is active
      if (isTranslationActive) {
        updateTranslationsDisplay(getTranslatedUtterances(), getActiveSpeakers());
      }
      
      sendResponse({ status: "success", displayMode: displayMode });
      return true;
    }
  });
  
  // Clean up when the page is unloaded
  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    closePopupWindow();
    clearTranslationTimers();
    
    if (safetyCheckTimer) {
      clearInterval(safetyCheckTimer);
      safetyCheckTimer = null;
    }
  });
  
  // Regular updates for displaying translations
  let updateDisplayInterval = null;
  
  function startDisplayUpdates() {
    // Clear existing interval if any
    if (updateDisplayInterval) {
      clearInterval(updateDisplayInterval);
    }
    
    // Set new interval
    updateDisplayInterval = setInterval(() => {
      if (isTranslationActive) {
        // Only update popup display
        updateTranslationsDisplay(
          getTranslatedUtterances(),
          getActiveSpeakers()
        );
      }
    }, UPDATE_PERIOD); // Update 4 times per second
  }
  
  // Start display updates
  startDisplayUpdates();
  
  debugLog("Content script initialized successfully");
})();