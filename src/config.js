// Configuration settings
const Config = {
  // API key for OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  
  // Default languages
  DEFAULT_INPUT_LANG: "Russian",
  DEFAULT_OUTPUT_LANG: "English",
  
  // Speech detection and buffering control
  SPEECH_SEGMENT_TIMEOUT: 40000,  // Minimal time between speech segments
  TRANSLATION_THROTTLE: 0,       // No delay for translation
  DEBOUNCE_DELAY: 0,            // No delay for UI updates
  REQUEST_DEDUP_WINDOW: 0,      // No deduplication window
  
  // OpenAI model to use
  MODEL_NAME: "gpt-3.5-turbo",
  
  // Translation settings
  TRANSLATION_SYSTEM_PROMPT: `You are a professional real-time translator. 
Translate from {inputLang} to {outputLang} accurately, maintaining the meaning, tone, and nuance of the original text.
Do not add any explanations, comments, or extra information.
Respond only with the translation, nothing else. Keep emoji and punctuation as in the original.`,
  
  // Debug settings
  MAX_DEBUG_LOGS: 100,
  
  // Request settings
  MAX_RETRIES: 0,               // No retries for failed requests
  RETRY_DELAY: 0,               // No delay between retries
  
  // Performance and stability
  MAX_STORED_UTTERANCES: 10,     // Limit for utterances per speaker
  SUBTITLE_PROCESSING_INTERVAL: 2000, // Wait 2000ms before processing subtitle changes
  OBSERVER_UPDATE_INTERVAL: 30000, // Health check interval for observer
  
  // API settings
  API_RATE_LIMIT: 500,          // Base rate limit for API requests (ms)
  API_TIMEOUT: 8000,            // Timeout for API requests (ms)
  API_CHECK_TIMEOUT: 5000,       // Timeout for API connection check (ms)
  
  // Max length of speech segments to preserve (to avoid memory issues)
  MAX_SPEECH_SEGMENT_LENGTH: 3000, // Increased from default to preserve longer texts
  
  // This delay controls how long we wait before refreshing the popup
  POPUP_REFRESH_INTERVAL: 500, // ms
};

export default Config;