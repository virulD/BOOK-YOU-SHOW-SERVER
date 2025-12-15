import { registerAs } from '@nestjs/config';

/**
 * Centralized configuration for Dialog Genie API
 * Masks sensitive values in logs
 */
export default registerAs('dialogGenie', () => {
  const apiKey = process.env.DIALOG_GENIE_API_KEY;
  const apiUrl = process.env.DIALOG_GENIE_API_URL || 'https://api.uat.geniebiz.lk';
  const paymentUrl = process.env.DIALOG_GENIE_PAYMENT_URL;
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  // Mask API key for logging (show first 10 and last 4 characters)
  const maskApiKey = (key: string | undefined): string => {
    if (!key) return 'NOT_SET';
    if (key.length <= 14) return '***MASKED***';
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  };

  return {
    apiKey,
    apiUrl,
    paymentUrl,
    appUrl,
    // Expose masked version for logging
    getMaskedApiKey: () => maskApiKey(apiKey),
    // Validation helper
    isApiKeyConfigured: () => {
      return !!apiKey && apiKey.trim().length > 0 && apiKey !== 'your_api_key_here';
    },
  };
});

