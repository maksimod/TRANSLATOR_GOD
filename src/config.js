// Configuration settings
const Config = {
  // API key for OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  
  // Default languages
  DEFAULT_INPUT_LANG: "auto",
  DEFAULT_OUTPUT_LANG: "en",
  
  // Speech detection and buffering control
  SPEECH_SEGMENT_TIMEOUT: 1000,  // Minimal time between speech segments
  TRANSLATION_THROTTLE: 0,       // No delay for translation
  DEBOUNCE_DELAY: 0,            // No delay for UI updates
  REQUEST_DEDUP_WINDOW: 0,      // No deduplication window
  
  // OpenAI model to use
  MODEL_NAME: "gpt-3.5-turbo-0125",
  
  // Translation settings
  TRANSLATION_SYSTEM_PROMPT: "Translate from {inputLang} to {outputLang}",
  
  // Debug settings
  MAX_DEBUG_LOGS: 100,
  
  // Request settings
  MAX_RETRIES: 0,               // No retries for failed requests
  RETRY_DELAY: 0,               // No delay between retries
  
  // Performance and stability
  MAX_STORED_UTTERANCES: 10,     // Limit for utterances per speaker
  SUBTITLE_PROCESSING_INTERVAL: 500, // Wait 500ms before processing subtitle changes
  OBSERVER_UPDATE_INTERVAL: 30000, // Health check interval for observer
  
  // API settings
  API_RATE_LIMIT: 750,          // Base rate limit for API requests (ms)
  API_TIMEOUT: 8000,            // Timeout for API requests (ms)
  API_CHECK_TIMEOUT: 5000       // Timeout for API connection check (ms)
};

export default Config;