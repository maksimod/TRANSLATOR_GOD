// Get references to UI elements
const inputLang = document.getElementById("inputLang");
const outputLang = document.getElementById("outputLang");
const applyButton = document.getElementById("applyButton");
const translationToggle = document.getElementById("translationToggle");
const statusMessage = document.getElementById("statusMessage");

// Function to update the UI based on the translation status
function updateStatusUI(isActive) {
  translationToggle.checked = isActive;
  
  if (isActive) {
    statusMessage.textContent = "Translation is ON";
    statusMessage.className = "status active";
  } else {
    statusMessage.textContent = "Translation is OFF";
    statusMessage.className = "status inactive";
  }
}

// Function to get the active tab
async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

// Function to focus the Teams tab and bring the popup on top
async function focusTeamsTab() {
  const tab = await getActiveTab();
  if (tab) {
    // Focus the tab first
    chrome.tabs.update(tab.id, { active: true });
    
    // Then force the popup window to appear on top
    const popupWindow = chrome.extension.getViews({ type: "popup" })[0];
    if (popupWindow) {
      popupWindow.focus();
    }
  }
}

// Function to check the current translation status
async function checkTranslationStatus() {
  try {
    const tab = await getActiveTab();
    
    // Inject content script if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    
    // Ask content.js for current status
    chrome.tabs.sendMessage(
      tab.id,
      { action: "checkStatus" },
      (response) => {
        if (response) {
          // Update UI based on current status
          updateStatusUI(response.isActive);
          
          // Update language selections if available
          if (response.inputLang) inputLang.value = response.inputLang;
          if (response.outputLang) outputLang.value = response.outputLang;
        } else {
          // No response, assume not active
          updateStatusUI(false);
        }
      }
    );
  } catch (error) {
    console.error("Error checking translation status:", error);
    updateStatusUI(false);
  }
}

// Load saved preferences and check current status when popup opens
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(["inputLang", "outputLang"], (data) => {
    if (data.inputLang) inputLang.value = data.inputLang;
    if (data.outputLang) outputLang.value = data.outputLang;
    
    // Check current translation status
    checkTranslationStatus();
  });
});

// Function to save preferences
function savePreferences() {
  const selectedInputLang = inputLang.value;
  const selectedOutputLang = outputLang.value;
  
  chrome.storage.sync.set(
    {
      inputLang: selectedInputLang,
      outputLang: selectedOutputLang,
    },
    () => {
      console.log("Preferences saved.");
      
      // Provide visual feedback that settings were saved
      const savedFeedback = document.createElement('div');
      savedFeedback.textContent = "Settings saved!";
      savedFeedback.style.position = "absolute";
      savedFeedback.style.bottom = "40px";
      savedFeedback.style.left = "50%";
      savedFeedback.style.transform = "translateX(-50%)";
      savedFeedback.style.backgroundColor = "#4CAF50";
      savedFeedback.style.color = "white";
      savedFeedback.style.padding = "5px 10px";
      savedFeedback.style.borderRadius = "4px";
      savedFeedback.style.zIndex = "1000";
      savedFeedback.style.opacity = "0";
      savedFeedback.style.transition = "opacity 0.3s ease";
      
      document.body.appendChild(savedFeedback);
      
      // Fade in
      setTimeout(() => {
        savedFeedback.style.opacity = "1";
      }, 10);
      
      // Fade out and remove
      setTimeout(() => {
        savedFeedback.style.opacity = "0";
        setTimeout(() => {
          document.body.removeChild(savedFeedback);
        }, 300);
      }, 2000);
    }
  );
  
  return { 
    inputLang: selectedInputLang, 
    outputLang: selectedOutputLang,
    displayMode: "popup" // Always use popup mode
  };
}

// Function to start translation
async function startTranslation(settings) {
  try {
    const tab = await getActiveTab();
    
    // Inject content script if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    
    // Send message to content.js to start translation
    chrome.tabs.sendMessage(
      tab.id,
      {
        action: "startTranslation",
        inputLang: settings.inputLang,
        outputLang: settings.outputLang,
        displayMode: "popup" // Always use popup mode
      },
      (response) => {
        if (response && response.status === "success") {
          console.log("Translation started successfully.");
          updateStatusUI(true);
        } else {
          console.error("Failed to start translation.");
          updateStatusUI(false);
          
          // Show error message
          if (response && response.message) {
            alert(`Error: ${response.message}`);
          }
        }
      }
    );
  } catch (error) {
    console.error("Error starting translation:", error);
    updateStatusUI(false);
  }
}

// Function to stop translation
async function stopTranslation() {
  try {
    const tab = await getActiveTab();
    
    // Send message to content.js to stop translation
    chrome.tabs.sendMessage(
      tab.id,
      { action: "stopTranslation" },
      (response) => {
        if (response && response.status === "success") {
          console.log("Translation stopped successfully.");
          updateStatusUI(false);
        } else {
          console.error("Failed to stop translation.");
        }
      }
    );
  } catch (error) {
    console.error("Error stopping translation:", error);
  }
}

// Handle toggle switch changes
translationToggle.addEventListener("change", () => {
  if (translationToggle.checked) {
    const settings = savePreferences();
    startTranslation(settings);
  } else {
    stopTranslation();
  }
});

// Handle apply button clicks
applyButton.addEventListener("click", () => {
  const settings = savePreferences();
  
  // Ensure popup stays on top by focusing the tab first, then the popup
  focusTeamsTab();
  
  if (translationToggle.checked) {
    // If translation is active, restart it with new settings
    startTranslation(settings);
  }
  
  // Add a subtle animation to the button to provide feedback
  applyButton.style.transition = "transform 0.2s ease";
  applyButton.style.transform = "scale(0.95)";
  
  setTimeout(() => {
    applyButton.style.transform = "scale(1)";
  }, 200);
});