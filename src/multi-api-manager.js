// Multi-API Manager: Rotates between Groq, Gemini, Hugging Face, and Cohere
// Zero token waste, automatic fallback, copy overlap solution

const API_CONFIGS = {
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    dailyLimit: 14400,
    style: 'conversational'
  },
  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    rateLimit: 60, // per minute
    style: 'informative'
  },
  huggingface: {
    name: 'Hugging Face',
    endpoint: 'https://api-inference.huggingface.co/models',
    models: ['mistralai/Mistral-7B-Instruct-v0.2', 'meta-llama/Llama-3.2-3B-Instruct'],
    style: 'detailed'
  },
  cohere: {
    name: 'Cohere',
    endpoint: 'https://api.cohere.ai/v1/chat',
    models: ['command-r', 'command-light'],
    style: 'professional'
  }
};

export class MultiAPIManager {
  constructor(env) {
    this.env = env;
    this.apiKeys = {
      groq: env.GROQ_API_KEY,
      gemini: env.GEMINI_API_KEY,
      huggingface: env.HUGGINGFACE_API_KEY,
      cohere: env.COHERE_API_KEY
    };
    this.usageTracker = {}; // Track daily usage
  }

  // Get usage stats from KV storage
  async getUsageStats() {
    const today = new Date().toISOString().split('T')[0];
    try {
      const stats = await this.env.API_USAGE?.get(`usage:${today}`);
      return stats ? JSON.parse(stats) : {};
    } catch {
      return {};
    }
  }

  // Save usage stats to KV storage
  async saveUsageStats(stats) {
    const today = new Date().toISOString().split('T')[0];
    try {
      await this.env.API_USAGE?.put(`usage:${today}`, JSON.stringify(stats), {
        expirationTtl: 86400 * 2 // 2 days
      });
    } catch (e) {
      console.error('Failed to save usage stats:', e);
    }
  }

  // Increment usage counter
  async trackUsage(provider, tokens = 1) {
    const stats = await this.getUsageStats();
    if (!stats[provider]) stats[provider] = { requests: 0, tokens: 0 };
    stats[provider].requests++;
    stats[provider].tokens += tokens;
    await this.saveUsageStats(stats);
    return stats[provider];
  }

  // Check if API is available (not rate limited)
  async isAvailable(provider) {
    const config = API_CONFIGS[provider];
    const stats = await this.getUsageStats();
    const used = stats[provider]?.requests || 0;

    if (provider === 'groq' && used >= config.dailyLimit) {
      return { available: false, reason: `Daily limit reached (${used}/${config.dailyLimit})` };
    }
    if (provider === 'gemini' && used >= config.rateLimit * 60) {
      return { available: false, reason: `Rate limit reached (${used} requests today)` };
    }

    return { available: true };
  }

  // Call Groq API
  async callGroq(messages, options = {}) {
    const config = API_CONFIGS.groq;
    const model = options.model || config.models[0];

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKeys.groq}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1200
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      text: data.choices[0]?.message?.content || '',
      tokens: data.usage?.total_tokens || 0,
      provider: 'groq',
      model
    };
  }

  // Call Gemini API
  async callGemini(messages, options = {}) {
    const config = API_CONFIGS.gemini;
    const model = options.model || config.models[0];

    // Convert messages to Gemini format
    const prompt = messages.map(m => m.content).join('\n\n');

    const response = await fetch(
      `${config.endpoint}/${model}:generateContent?key=${this.apiKeys.gemini}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options.temperature || 0.7,
            maxOutputTokens: options.max_tokens || 1200
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      text: data.candidates[0]?.content?.parts[0]?.text || '',
      tokens: data.usageMetadata?.totalTokenCount || 0,
      provider: 'gemini',
      model
    };
  }

  // Call Hugging Face API
  async callHuggingFace(messages, options = {}) {
    const config = API_CONFIGS.huggingface;
    const model = options.model || config.models[0];

    const prompt = messages.map(m => m.content).join('\n\n');

    const response = await fetch(`${config.endpoint}/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKeys.huggingface}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          temperature: options.temperature || 0.7,
          max_new_tokens: options.max_tokens || 1200,
          return_full_text: false
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      text: data[0]?.generated_text || '',
      tokens: 0, // HF doesn't always return token count
      provider: 'huggingface',
      model
    };
  }

  // Call Cohere API
  async callCohere(messages, options = {}) {
    const config = API_CONFIGS.cohere;
    const model = options.model || config.models[0];

    const prompt = messages[messages.length - 1]?.content || '';

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKeys.cohere}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        message: prompt,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1200
      })
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      tokens: data.meta?.tokens?.output_tokens || 0,
      provider: 'cohere',
      model
    };
  }

  // Main function: Try APIs in priority order with automatic fallback
  async generate(messages, options = {}) {
    const errors = [];
    const providers = ['groq', 'gemini', 'huggingface', 'cohere'];

    for (const provider of providers) {
      // Check availability
      const availability = await this.isAvailable(provider);
      if (!availability.available) {
        errors.push(`${provider}: ${availability.reason}`);
        continue;
      }

      // Skip if API key missing
      if (!this.apiKeys[provider]) {
        errors.push(`${provider}: API key not configured`);
        continue;
      }

      try {
        let result;
        switch (provider) {
          case 'groq':
            result = await this.callGroq(messages, options);
            break;
          case 'gemini':
            result = await this.callGemini(messages, options);
            break;
          case 'huggingface':
            result = await this.callHuggingFace(messages, options);
            break;
          case 'cohere':
            result = await this.callCohere(messages, options);
            break;
        }

        if (result.text && result.text.trim()) {
          // Success! Track usage and return
          await this.trackUsage(provider, result.tokens);
          return {
            text: result.text,
            provider: result.provider,
            model: result.model,
            tokens: result.tokens,
            errors
          };
        }

        errors.push(`${provider}: Empty response`);
      } catch (e) {
        errors.push(`${provider}: ${e.message}`);
      }
    }

    // All APIs failed
    return {
      text: '',
      provider: null,
      model: null,
      tokens: 0,
      errors
    };
  }

  // Get current status of all APIs
  async getStatus() {
    const stats = await this.getUsageStats();
    const status = {};

    for (const provider of Object.keys(API_CONFIGS)) {
      const config = API_CONFIGS[provider];
      const usage = stats[provider] || { requests: 0, tokens: 0 };
      const availability = await this.isAvailable(provider);

      status[provider] = {
        name: config.name,
        available: availability.available,
        reason: availability.reason || 'Available',
        requests: usage.requests,
        tokens: usage.tokens,
        limit: config.dailyLimit || config.rateLimit || 'Unlimited',
        hasApiKey: !!this.apiKeys[provider]
      };
    }

    return status;
  }
}

// Helper function for backward compatibility with existing code
export async function runAI(env, messages, opts = {}) {
  const manager = new MultiAPIManager(env);
  const result = await manager.generate(messages, opts);

  return {
    text: result.text,
    model: result.model || 'unknown',
    provider: result.provider || 'none',
    errors: result.errors || [],
    tokens: result.tokens || 0
  };
}
