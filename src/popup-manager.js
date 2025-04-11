// Popup window management
import { debugLog, getDebugLogs } from './utils.js';

// Reference to the popup window
let popupWindow = null;

// Set interval to check popup window status
let popupCheckInterval = null;

// Set timeout for popup initialization
let popupInitTimeout = null;

// Prevent reopening too frequently
let lastPopupCreationTime = 0;

// Track all accumulated translations by speaker and utterance ID
let accumulatedTranslations = {};

// Maintain speaker history to preserve order
let speakerDisplayOrder = [];

/**
 * Open the translations window
 * @param {Function} updateTranslationsDisplay - Function to update translations
 * @returns {Window|null} - Reference to the popup window
 */
function openTranslationsWindow(updateTranslationsDisplay) {
  try {
    // Prevent reopening too frequently
    const now = Date.now();
    if (now - lastPopupCreationTime < 3000) {
      return popupWindow;
    }
    lastPopupCreationTime = now;
    
    // Only create new window if needed
    if (!popupWindow || popupWindow.closed) {
      popupWindow = window.open("", "TranslatedSubtitles", "width=600,height=500");
      
      if (!popupWindow) {
        console.error("Popup window was blocked. Please allow popups for this site.");
        return null;
      }
      
      const popupContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Teams Subtitle Translator</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 0;
              margin: 0;
              height: 100vh;
              display: flex;
              flex-direction: column;
              background-color: #f9f9f9;
            }
            header {
              background-color: #0078d4;
              color: white;
              padding: 10px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              position: sticky;
              top: 0;
              z-index: 100;
            }
            h2 {
              margin: 0;
              font-size: 18px;
            }
            .tab-container {
              display: flex;
              background: #f0f0f0;
              border-bottom: 1px solid #ddd;
              position: sticky;
              top: 42px;
              z-index: 100;
            }
            .tab {
              padding: 10px 15px;
              cursor: pointer;
              border-right: 1px solid #ddd;
            }
            .tab.active {
              background: #fff;
              font-weight: bold;
              border-bottom: 2px solid #0078d4;
            }
            #main-container {
              flex-grow: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
            }
            #subtitles-container {
              flex-grow: 1;
              overflow-y: auto;
              padding: 15px;
              background-color: white;
              scroll-behavior: smooth;
            }
            #debug-container {
              flex-grow: 1;
              overflow-y: auto;
              padding: 15px;
              background-color: white;
              font-family: monospace;
              font-size: 12px;
              display: none;
            }
            .speaker-block {
              margin-bottom: 20px;
              border-left: 3px solid #0078d4;
              padding-left: 10px;
            }
            .speaker-name {
              font-weight: bold;
              color: #0078d4;
              margin-bottom: 5px;
              display: flex;
              align-items: center;
            }
            .speaker-avatar {
              width: 24px;
              height: 24px;
              border-radius: 50%;
              background-color: #0078d4;
              margin-right: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 12px;
              font-weight: bold;
              overflow: hidden;
            }
            .utterances-container {
              margin-top: 5px;
            }
            .utterance {
              margin-bottom: 10px;
              padding: 10px;
              background-color: #f9f9f9;
              border-radius: 5px;
              border: 1px solid #eee;
              transition: background-color 0.3s ease, border-color 0.3s ease;
              animation: fadeIn 0.3s ease;
            }
            .utterance.active {
              background-color: #f0f7ff;
              border-color: #0078d4;
              animation: pulse 2s infinite;
            }
            @keyframes pulse {
              0% {
                border-color: #0078d4;
              }
              50% {
                border-color: #66b0ff;
              }
              100% {
                border-color: #0078d4;
              }
            }
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(5px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .utterance-text {
              font-size: 15px;
              line-height: 1.4;
            }
            .timestamp {
              font-size: 11px;
              color: #888;
              margin-top: 5px;
              text-align: right;
            }
            .controls {
              padding: 10px;
              display: flex;
              justify-content: space-between;
              background: white;
              border-top: 1px solid #ddd;
              position: sticky;
              bottom: 0;
              z-index: 100;
            }
            button {
              padding: 8px 15px;
              cursor: pointer;
              background-color: #0078d4;
              color: white;
              border: none;
              border-radius: 3px;
              font-weight: bold;
              transition: background-color 0.2s ease;
            }
            button:hover {
              background-color: #106ebe;
            }
            .debug-entry {
              color: #666;
              margin-bottom: 3px;
            }
            .badge {
              display: inline-block;
              font-size: 11px;
              padding: 2px 5px;
              border-radius: 3px;
              margin-left: 5px;
              background-color: #f0f0f0;
              color: #666;
            }
            .badge.active {
              background-color: #0078d4;
              color: white;
            }
            .time-group-separator {
              text-align: center;
              margin: 20px 0;
              border-bottom: 1px solid #ddd;
              line-height: 0.1em;
              color: #888;
              font-size: 12px;
            }
            .time-group-separator span {
              background: #fff;
              padding: 0 10px;
            }
            #auto-scroll-toggle {
              position: absolute;
              right: 15px;
              bottom: 60px;
              z-index: 90;
              display: flex;
              align-items: center;
              background: rgba(255,255,255,0.9);
              padding: 5px 10px;
              border-radius: 20px;
              box-shadow: 0 2px 5px rgba(0,0,0,0.2);
              cursor: pointer;
              user-select: none;
            }
            .toggle-switch {
              position: relative;
              display: inline-block;
              width: 40px;
              height: 20px;
              margin-left: 8px;
            }
            .toggle-switch input {
              opacity: 0;
              width: 0;
              height: 0;
            }
            .toggle-slider {
              position: absolute;
              cursor: pointer;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background-color: #ccc;
              transition: .4s;
              border-radius: 34px;
            }
            .toggle-slider:before {
              position: absolute;
              content: "";
              height: 16px;
              width: 16px;
              left: 2px;
              bottom: 2px;
              background-color: white;
              transition: .4s;
              border-radius: 50%;
            }
            input:checked + .toggle-slider {
              background-color: #0078d4;
            }
            input:checked + .toggle-slider:before {
              transform: translateX(20px);
            }
          </style>
        </head>
        <body>
          <header>
            <h2>Teams Subtitle Translator</h2>
            <span id="status-badge" class="badge active">Active</span>
          </header>
          
          <div class="tab-container">
            <div id="translations-tab" class="tab active">Translations</div>
            <div id="debug-tab" class="tab">Debug</div>
          </div>
          
          <div id="main-container">
            <div id="subtitles-container"></div>
            <div id="debug-container"></div>
            
            <div id="auto-scroll-toggle">
              Auto-scroll
              <label class="toggle-switch">
                <input type="checkbox" id="auto-scroll-checkbox" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          
          <div class="controls">
            <button id="clearBtn">Clear All</button>
            <button id="copyBtn">Copy to Clipboard</button>
          </div>
        </body>
        </html>
      `;
      
      popupWindow.document.open();
      popupWindow.document.write(popupContent);
      popupWindow.document.close();
      
      // Give window time to initialize
      clearTimeout(popupInitTimeout);
      popupInitTimeout = setTimeout(() => {
        setupPopupEventListeners(updateTranslationsDisplay);
        debugLog("Popup event listeners setup complete");
        
        // Force an initial update
        updateTranslationsDisplay({}, {});
      }, 300);
      
      // Start checking the popup window status
      startPopupCheck(updateTranslationsDisplay);
      
      debugLog("Popup window opened successfully");
    }
    
    return popupWindow;
  } catch (error) {
    console.error("Error opening translations window:", error);
    return null;
  }
}

/**
 * Setup event listeners for the popup window
 * @param {Function} updateTranslationsDisplay - Function to update translations
 */
function setupPopupEventListeners(updateTranslationsDisplay) {
  if (!isPopupAccessible()) return;
  
  try {
    // Tab switching
    const translationsTab = popupWindow.document.getElementById('translations-tab');
    const debugTab = popupWindow.document.getElementById('debug-tab');
    const subtitlesContainer = popupWindow.document.getElementById('subtitles-container');
    const debugContainer = popupWindow.document.getElementById('debug-container');
    
    if (translationsTab && debugTab && subtitlesContainer && debugContainer) {
      translationsTab.addEventListener('click', function() {
        translationsTab.classList.add('active');
        debugTab.classList.remove('active');
        subtitlesContainer.style.display = 'block';
        debugContainer.style.display = 'none';
      });
      
      debugTab.addEventListener('click', function() {
        debugTab.classList.add('active');
        translationsTab.classList.remove('active');
        subtitlesContainer.style.display = 'none';
        debugContainer.style.display = 'block';
      });
    }
    
    // Clear button
    const clearBtn = popupWindow.document.getElementById('clearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (window.clearAllTranslations && typeof window.clearAllTranslations === 'function') {
          // Reset our accumulated translations
          accumulatedTranslations = {};
          speakerDisplayOrder = [];
          window.clearAllTranslations();
        }
      });
    }
    
    // Copy button
    const copyBtn = popupWindow.document.getElementById('copyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        if (!subtitlesContainer) return;
        
        const text = Array.from(subtitlesContainer.querySelectorAll('.speaker-block')).map(block => {
          const speakerNameEl = block.querySelector('.speaker-name');
          const speaker = speakerNameEl ? speakerNameEl.textContent.trim() : 'Unknown';
          const utterances = Array.from(block.querySelectorAll('.utterance-text')).map(u => u.textContent);
          return speaker + ':\n' + utterances.join('\n');
        }).join('\n\n');
        
        popupWindow.navigator.clipboard.writeText(text)
          .then(() => {
            // Show a temporary success message
            const copyFeedback = popupWindow.document.createElement('div');
            copyFeedback.textContent = 'Copied to clipboard!';
            copyFeedback.style.position = 'fixed';
            copyFeedback.style.bottom = '60px';
            copyFeedback.style.left = '50%';
            copyFeedback.style.transform = 'translateX(-50%)';
            copyFeedback.style.backgroundColor = '#0078d4';
            copyFeedback.style.color = 'white';
            copyFeedback.style.padding = '8px 16px';
            copyFeedback.style.borderRadius = '4px';
            copyFeedback.style.zIndex = '1000';
            copyFeedback.style.opacity = '0';
            copyFeedback.style.transition = 'opacity 0.3s ease';
            
            popupWindow.document.body.appendChild(copyFeedback);
            
            // Fade in
            setTimeout(() => {
              copyFeedback.style.opacity = '1';
            }, 10);
            
            // Fade out and remove
            setTimeout(() => {
              copyFeedback.style.opacity = '0';
              setTimeout(() => {
                popupWindow.document.body.removeChild(copyFeedback);
              }, 300);
            }, 2000);
          })
          .catch(err => alert('Failed to copy: ' + err.message));
      });
    }
    
    // Auto-scroll toggle
    const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
    if (autoScrollCheckbox) {
      autoScrollCheckbox.addEventListener('change', function() {
        const shouldAutoScroll = autoScrollCheckbox.checked;
        
        if (shouldAutoScroll && subtitlesContainer) {
          // If turned on, immediately scroll to bottom
          subtitlesContainer.scrollTop = subtitlesContainer.scrollHeight;
        }
      });
    }
    
    // Handle manual scrolling to disable auto-scroll
    if (subtitlesContainer) {
      let userHasScrolled = false;
      
      subtitlesContainer.addEventListener('wheel', function() {
        const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
        if (!autoScrollCheckbox) return;
        
        // Get scroll position info
        const isAtBottom = subtitlesContainer.scrollHeight - subtitlesContainer.scrollTop - subtitlesContainer.clientHeight < 50;
        
        // If scrolling up, disable auto-scroll
        if (!isAtBottom) {
          userHasScrolled = true;
          autoScrollCheckbox.checked = false;
        }
        
        // If scrolled to bottom, re-enable auto-scroll
        if (isAtBottom && userHasScrolled) {
          userHasScrolled = false;
          autoScrollCheckbox.checked = true;
        }
      });
      
      // Also handle scroll events from scrollbar dragging
      subtitlesContainer.addEventListener('scroll', function() {
        const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
        if (!autoScrollCheckbox) return;
        
        // Get scroll position info
        const isAtBottom = subtitlesContainer.scrollHeight - subtitlesContainer.scrollTop - subtitlesContainer.clientHeight < 50;
        
        // If not at bottom and was auto-scrolling, disable it
        if (!isAtBottom && autoScrollCheckbox.checked) {
          userHasScrolled = true;
          autoScrollCheckbox.checked = false;
        }
        
        // If scrolled to bottom manually, re-enable auto-scroll
        if (isAtBottom && userHasScrolled) {
          userHasScrolled = false;
          autoScrollCheckbox.checked = true;
        }
      });
    }
    
    // Setup scroll handling for both containers
    setupDebugScrollHandling();
    
    debugLog("Popup event listeners set up successfully");
  } catch (error) {
    console.error("Error setting up popup event listeners:", error);
  }
}

/**
 * Check if popup window is accessible and responsive
 * @returns {boolean} - True if popup is accessible
 */
function isPopupAccessible() {
  try {
    return popupWindow && !popupWindow.closed && popupWindow.document;
  } catch (e) {
    return false;
  }
}

/**
 * Update debug logs in the popup window
 */
function updateDebugLogs() {
  if (!isPopupAccessible()) return;
  
  try {
    const debugContainer = popupWindow.document.getElementById('debug-container');
    if (debugContainer) {
      // Get logs
      const logs = getDebugLogs();
      
      // Only update if there are logs
      if (logs.length === 0) return;
      
      // Clear container
      debugContainer.innerHTML = '';
      
      // Add logs as a batch
      const fragment = popupWindow.document.createDocumentFragment();
      
      for (const log of logs) {
        const logDiv = popupWindow.document.createElement('div');
        logDiv.className = 'debug-entry';
        logDiv.textContent = log;
        fragment.appendChild(logDiv);
      }
      
      debugContainer.appendChild(fragment);
      
      // Check if auto-scroll is enabled
      const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
      const shouldAutoScroll = autoScrollCheckbox && autoScrollCheckbox.checked;
      
      // Auto-scroll to bottom only if enabled
      if (shouldAutoScroll) {
        debugContainer.scrollTop = debugContainer.scrollHeight;
      }
    }
  } catch (error) {
    console.error("Error updating debug logs:", error);
  }
}

/**
 * Start checking popup window status
 * @param {Function} updateTranslationsDisplay - Function to update translations
 */
function startPopupCheck(updateTranslationsDisplay) {
  if (popupCheckInterval) {
    clearInterval(popupCheckInterval);
  }
  
  popupCheckInterval = setInterval(() => {
    if (window.isTranslationActive) {
      if (!isPopupAccessible()) {
        debugLog("Popup window was closed, reopening...");
        openTranslationsWindow(updateTranslationsDisplay);
      }
    }
  }, 3000); // Check every 3 seconds
}

/**
 * Stop popup check interval
 */
function stopPopupCheck() {
  if (popupCheckInterval) {
    clearInterval(popupCheckInterval);
    popupCheckInterval = null;
  }
}

/**
 * Create avatar for speaker
 * @param {string} speakerName - Speaker's name
 * @returns {HTMLElement} - Avatar element
 */
function createSpeakerAvatar(speakerName) {
  const avatar = popupWindow.document.createElement('div');
  avatar.className = 'speaker-avatar';
  
  // Generate a consistent color based on the speaker name
  const nameHash = Array.from(speakerName).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = nameHash % 360;
  avatar.style.backgroundColor = `hsl(${hue}, 70%, 45%)`;
  
  // Get initials (up to 2 characters)
  const initials = speakerName
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
  
  avatar.textContent = initials || '?';
  
  return avatar;
}

/**
 * Update the translations display in the popup window
 * @param {Object} translatedUtterances - Map of speaker IDs to arrays of utterances
 * @param {Object} activeSpeakers - Map of speaker IDs to active speakers
 */
function updateTranslationsDisplay(translatedUtterances, activeSpeakers) {
  if (!isPopupAccessible()) {
    return;
  }
  
  try {
    // Get the subtitles container
    const subtitlesContainer = popupWindow.document.getElementById('subtitles-container');
    if (!subtitlesContainer) return;
    
    // Check if auto-scroll is enabled
    const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
    const shouldAutoScroll = autoScrollCheckbox && autoScrollCheckbox.checked;
    
    // Process finalized utterances and add them to accumulatedTranslations
    for (const speakerId in translatedUtterances) {
      // Handle the new array structure
      const utterances = translatedUtterances[speakerId];
      if (!utterances || !Array.isArray(utterances) || utterances.length === 0) {
        continue;
      }
      
      // Get the speaker name from the first utterance
      const speakerName = utterances[0].speaker || "Unknown";
      
      // Initialize speaker object if needed
      if (!accumulatedTranslations[speakerId]) {
        accumulatedTranslations[speakerId] = {
          speaker: speakerName,
          utterances: {}
        };
        
        // Add to display order if new
        if (!speakerDisplayOrder.includes(speakerId)) {
          speakerDisplayOrder.push(speakerId);
        }
      }
      
      // Process each utterance in the array
      for (const utterance of utterances) {
        if (!utterance || !utterance.utteranceId) continue;
        
        // Update or add the utterance
        accumulatedTranslations[speakerId].utterances[utterance.utteranceId] = {
          id: utterance.utteranceId,
          speaker: utterance.speaker || speakerName,
          speakerId: speakerId,
          original: utterance.fullText || "",
          translated: utterance.translatedText || "Translating...",
          timestamp: utterance.timestamp || new Date().toLocaleTimeString(),
          active: utterance.active === true,
          avatar: utterance.avatar
        };
      }
    }
    
    // Update active utterances (they may override finalized ones)
    for (const speakerId in activeSpeakers) {
      const speaker = activeSpeakers[speakerId];
      
      // Skip if speaker object is empty or incomplete
      if (!speaker || !speaker.speaker) continue;
      
      // Initialize speaker object if needed
      if (!accumulatedTranslations[speakerId]) {
        accumulatedTranslations[speakerId] = {
          speaker: speaker.speaker,
          utterances: {}
        };
        
        // Add to display order if new
        if (!speakerDisplayOrder.includes(speakerId)) {
          speakerDisplayOrder.push(speakerId);
        }
      }
      
      // Skip update if there's no content to display
      if (!speaker.utteranceId || speaker.fullText === "") continue;
      
      // Update or add the active utterance
      accumulatedTranslations[speakerId].utterances[speaker.utteranceId] = {
        id: speaker.utteranceId,
        speaker: speaker.speaker,
        speakerId: speakerId,
        original: speaker.fullText,
        translated: speaker.translatedText || "Translating...",
        timestamp: new Date().toLocaleTimeString(),
        active: true,
        avatar: speaker.avatar
      };
    }
    
    // Process speakers in the display order
    for (const speakerId of speakerDisplayOrder) {
      if (!accumulatedTranslations[speakerId]) continue;
      
      const speakerData = accumulatedTranslations[speakerId];
      const utterances = Object.values(speakerData.utterances);
      
      // Skip if no utterances
      if (utterances.length === 0) continue;
      
      // Sort utterances by ID (which is timestamp-based)
      utterances.sort((a, b) => a.id - b.id);
      
      // Get or create speaker block
      let speakerBlock = popupWindow.document.getElementById(`speaker-${speakerId}`);
      const isNewSpeakerBlock = !speakerBlock;
      
      if (isNewSpeakerBlock) {
        speakerBlock = popupWindow.document.createElement('div');
        speakerBlock.className = 'speaker-block';
        speakerBlock.id = `speaker-${speakerId}`;
        speakerBlock.dataset.speakerId = speakerId;
        
        // Create speaker name header with avatar
        const speakerName = popupWindow.document.createElement('div');
        speakerName.className = 'speaker-name';
        
        // Add avatar
        const avatar = createSpeakerAvatar(speakerData.speaker);
        speakerName.appendChild(avatar);
        
        // Add name text
        const nameText = popupWindow.document.createTextNode(speakerData.speaker);
        speakerName.appendChild(nameText);
        
        speakerBlock.appendChild(speakerName);
        
        // Create utterances container
        const utterancesContainer = popupWindow.document.createElement('div');
        utterancesContainer.className = 'utterances-container';
        utterancesContainer.id = `utterances-${speakerId}`;
        speakerBlock.appendChild(utterancesContainer);
      }
      
      // Get utterances container
      const utterancesContainer = speakerBlock.querySelector(`.utterances-container`);
      
      // Process utterances
      utterances.forEach(utterance => {
        const utteranceId = utterance.id;
        
        // Check if utterance element already exists
        let utteranceEl = utterancesContainer.querySelector(`.utterance[data-utterance-id="${utteranceId}"]`);
        const isNewUtterance = !utteranceEl;
        
        if (isNewUtterance) {
          // Create new utterance element
          utteranceEl = popupWindow.document.createElement('div');
          utteranceEl.className = utterance.active ? 'utterance active' : 'utterance';
          utteranceEl.dataset.utteranceId = utteranceId;
          
          // Utterance text
          const textDiv = popupWindow.document.createElement('div');
          textDiv.className = 'utterance-text';
          textDiv.textContent = utterance.translated || "";
          utteranceEl.appendChild(textDiv);
          
          // Timestamp
          const timeDiv = popupWindow.document.createElement('div');
          timeDiv.className = 'timestamp';
          timeDiv.textContent = utterance.timestamp || "";
          utteranceEl.appendChild(timeDiv);
          
          // Add to container (at the correct position by time)
          let inserted = false;
          Array.from(utterancesContainer.querySelectorAll('.utterance')).some(existingUtterance => {
            const existingId = parseInt(existingUtterance.dataset.utteranceId);
            const currentId = parseInt(utteranceId);
            
            if (existingId > currentId) {
              utterancesContainer.insertBefore(utteranceEl, existingUtterance);
              inserted = true;
              return true;
            }
            return false;
          });
          
          // If not inserted (i.e., it's the newest), append to end
          if (!inserted) {
            utterancesContainer.appendChild(utteranceEl);
          }
        } else {
          // Update existing utterance text if it has changed
          const textDiv = utteranceEl.querySelector('.utterance-text');
          if (textDiv && textDiv.textContent !== utterance.translated) {
            textDiv.textContent = utterance.translated || "";
          }
          
          // Update active state
          if (utterance.active) {
            utteranceEl.classList.add('active');
          } else {
            utteranceEl.classList.remove('active');
          }
        }
      });
      
      // If new speaker block, add to container
      if (isNewSpeakerBlock) {
        subtitlesContainer.appendChild(speakerBlock);
      }
    }
    
    // Auto-scroll if enabled
    if (shouldAutoScroll) {
      subtitlesContainer.scrollTop = subtitlesContainer.scrollHeight;
    }
    
    // Also update debug logs
    updateDebugLogs();
  } catch (error) {
    console.error("Error updating translations display:", error);
    debugLog(`Error updating display: ${error.message}`);
  }
}

/**
 * Set translation status in popup
 * @param {boolean} isActive - Whether translation is active
 */
function setTranslationStatus(isActive) {
  if (!isPopupAccessible()) return;
  
  try {
    const statusBadge = popupWindow.document.getElementById('status-badge');
    if (statusBadge) {
      statusBadge.textContent = isActive ? 'Active' : 'Inactive';
      statusBadge.className = isActive ? 'badge active' : 'badge';
    }
  } catch (e) {
    console.error("Error updating status:", e);
  }
}

/**
 * Clear all accumulated translations
 */
function clearAccumulatedTranslations() {
  accumulatedTranslations = {};
  speakerDisplayOrder = [];
}

/**
 * Close popup window
 */
function closePopupWindow() {
  if (popupWindow && !popupWindow.closed) {
    try {
      popupWindow.close();
    } catch (e) {
      console.error("Error closing popup window:", e);
    }
  }
  
  popupWindow = null;
  clearAccumulatedTranslations();
}

// Add debug container scroll handling
function setupDebugScrollHandling() {
  if (!isPopupAccessible()) return;
  
  try {
    const debugContainer = popupWindow.document.getElementById('debug-container');
    if (debugContainer) {
      let userHasScrolled = false;
      
      debugContainer.addEventListener('wheel', function() {
        const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
        if (!autoScrollCheckbox) return;
        
        // Get scroll position info
        const isAtBottom = debugContainer.scrollHeight - debugContainer.scrollTop - debugContainer.clientHeight < 50;
        
        // If scrolling up, disable auto-scroll
        if (!isAtBottom) {
          userHasScrolled = true;
          autoScrollCheckbox.checked = false;
        }
        
        // If scrolled to bottom, re-enable auto-scroll
        if (isAtBottom && userHasScrolled) {
          userHasScrolled = false;
          autoScrollCheckbox.checked = true;
        }
      });
      
      // Also handle scroll events from scrollbar dragging
      debugContainer.addEventListener('scroll', function() {
        const autoScrollCheckbox = popupWindow.document.getElementById('auto-scroll-checkbox');
        if (!autoScrollCheckbox) return;
        
        // Get scroll position info
        const isAtBottom = debugContainer.scrollHeight - debugContainer.scrollTop - debugContainer.clientHeight < 50;
        
        // If not at bottom and was auto-scrolling, disable it
        if (!isAtBottom && autoScrollCheckbox.checked) {
          userHasScrolled = true;
          autoScrollCheckbox.checked = false;
        }
        
        // If scrolled to bottom manually, re-enable auto-scroll
        if (isAtBottom && userHasScrolled) {
          userHasScrolled = false;
          autoScrollCheckbox.checked = true;
        }
      });
    }
  } catch (error) {
    console.error("Error setting up debug scroll handling:", error);
  }
}

export {
  openTranslationsWindow,
  updateTranslationsDisplay,
  updateDebugLogs,
  setTranslationStatus,
  stopPopupCheck,
  closePopupWindow,
  clearAccumulatedTranslations
};