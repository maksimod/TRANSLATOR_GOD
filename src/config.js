// Configuration settings
const Config = {
  // API key for OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  
  // Default languages
  DEFAULT_INPUT_LANG: "auto",
  DEFAULT_OUTPUT_LANG: "en",
  
  // Speech detection and buffering control
  SPEECH_SEGMENT_TIMEOUT: 3000,  // Time between speech segments
  TRANSLATION_THROTTLE: 1000,    // Delay between translation requests
  DEBOUNCE_DELAY: 100,           // Delay for debouncing DOM updates
  
  // OpenAI model to use
  MODEL_NAME: "gpt-3.5-turbo-0125",
  
  // Debug settings
  MAX_DEBUG_LOGS: 100,
  
  // Request settings
  MAX_RETRIES: 1,                // Number of retries for failed requests
  RETRY_DELAY: 800,              // Delay between retries
  
  // Performance and stability
  MAX_STORED_UTTERANCES: 10,     // Limit for utterances per speaker
  SUBTITLE_PROCESSING_INTERVAL: 300, // Rate limiting for subtitle processing
  OBSERVER_UPDATE_INTERVAL: 30000 // Health check interval for observer
};

export default Config;