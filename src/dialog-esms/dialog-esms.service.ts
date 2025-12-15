import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { RedisService } from '../redis/redis.service';

const REDIS_TOKEN_KEY = 'dialog_esms:token';

interface DialogEsmsLoginResponse {
  status?: string;
  comment?: string;
  token?: string;
  expiration?: number; // Time in seconds (per official API doc v2.9)
  expires_in?: number; // Fallback for compatibility
  remainingCount?: number;
  refreshToken?: string;
  refreshExpiration?: number;
  userData?: any;
  accountType?: number;
  accountLocked?: number;
  accountStatus?: number;
  walletBalance?: number;
  additional_addons?: string;
  data?: string;
  errCode?: number;
  [key: string]: any;
}

interface DialogEsmsSendResponse {
  success?: boolean;
  message?: string;
  transaction_id?: string;
  [key: string]: any;
}

export interface SmsSendResult {
  success: boolean;
  transactionId?: string | number;
  phone: string;
  formattedPhone: string;
  message: string;
  error?: string;
  timestamp: Date;
}

export interface MessageStatus {
  transactionId: string | number;
  phone: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
  statusDescription?: string;
  sentAt: Date;
  deliveredAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class DialogEsmsService implements OnModuleInit {
  private readonly logger = new Logger(DialogEsmsService.name);
  private readonly baseUrl = 'https://e-sms.dialog.lk/api/v2';
  private readonly tokenRefreshBuffer = 60000; // Refresh token 1 minute before expiry
  // In-memory storage for message status (consider using Redis or DB for production)
  private messageStatusMap: Map<string, MessageStatus> = new Map();

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  /**
   * Generate a simple numeric hash from a string
   * Used to create unique transaction IDs
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  onModuleInit() {
    const enabled = this.isEnabled();
    this.logger.log(`Dialog eSMS Service initialized. Enabled: ${enabled}`);
    if (enabled) {
      this.logger.log(`Sender ID: ${this.getSenderId()}`);
      this.logger.log(`Push URL: ${this.getPushUrl() || 'Not configured'}`);
    }
  }

  /**
   * Check if Dialog eSMS is enabled
   */
  isEnabled(): boolean {
    const enabled = this.configService.get<string>('ESMS_ENABLED');
    return enabled === 'true' || enabled === '1';
  }

  /**
   * Get username from environment
   */
  private getUsername(): string {
    return (
      this.configService.get<string>('ESMS_USERNAME') ||
      process.env.ESMS_USERNAME ||
      ''
    );
  }

  /**
   * Get password from environment
   */
  private getPassword(): string {
    return (
      this.configService.get<string>('ESMS_PASSWORD') ||
      process.env.ESMS_PASSWORD ||
      ''
    );
  }

  /**
   * Get sender ID from environment
   */
  getSenderId(): string {
    return (
      this.configService.get<string>('ESMS_SENDER_ID') ||
      process.env.ESMS_SENDER_ID ||
      'BookYourShow'
    );
  }

  /**
   * Get push URL from environment (with ngrok support)
   */
  getPushUrl(): string | null {
    // First check if ESMS_PUSH_URL is explicitly set
    const explicitPushUrl = this.configService.get<string>('ESMS_PUSH_URL') || process.env.ESMS_PUSH_URL;
    if (explicitPushUrl) {
      return explicitPushUrl;
    }

    // If NGROK_URL is set, construct the push URL
    const ngrokUrl = this.configService.get<string>('NGROK_URL') || process.env.NGROK_URL;
    if (ngrokUrl) {
      const cleanUrl = ngrokUrl.replace(/\/$/, ''); // Remove trailing slash
      return `${cleanUrl}/api/esms/delivery-report`;
    }

    return null;
  }

  /**
   * Get or refresh authentication token
   */
  async getToken(): Promise<string> {
    try {
      // Check if we have a valid cached token in Redis
      const cachedToken = await this.redisService.get(REDIS_TOKEN_KEY);
      
      if (cachedToken) {
        // Check TTL to ensure token is still valid (with buffer)
        const ttl = await this.redisService.ttl(REDIS_TOKEN_KEY);
        if (ttl > this.tokenRefreshBuffer / 1000) { // Convert buffer to seconds
          this.logger.log(`✅ Using cached token from Redis (TTL: ${ttl} seconds)`);
          return cachedToken;
        } else {
          this.logger.log(`⚠️ Cached token expires soon (TTL: ${ttl} seconds), refreshing...`);
        }
      }

      // Token expired or doesn't exist, fetch a new one
      return await this.refreshToken();
    } catch (error: any) {
      this.logger.error(`Error getting token from Redis: ${error.message}`);
      // Fallback: try to refresh token
      return await this.refreshToken();
    }
  }

  /**
   * Refresh authentication token
   */
  async refreshToken(): Promise<string> {
    try {
      const username = this.getUsername();
      const password = this.getPassword();

      if (!username || !password) {
        throw new Error('ESMS_USERNAME and ESMS_PASSWORD must be configured');
      }

      this.logger.log('Refreshing Dialog eSMS authentication token...');

      const response = await axios.post<DialogEsmsLoginResponse>(
        `${this.baseUrl}/user/login`,
        {
          username,
          password,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      // Check response status first (per official API doc v2.9)
      if (response.data.status !== 'success') {
        const errorMsg = response.data.comment || 'Login failed';
        const errCode = response.data.errCode || 'UNKNOWN';
        throw new Error(`Dialog eSMS login failed: ${errorMsg} (Error Code: ${errCode})`);
      }

      const token = response.data.token;
      if (!token) {
        this.logger.error(`Token not found in response. Response data: ${JSON.stringify(response.data)}`);
        throw new Error('Dialog eSMS API did not return a token in the response');
      }
      
      // Trim token to remove any whitespace/newlines that might cause issues
      const trimmedToken = token.trim();
      this.logger.log(`Token received from login API (first 50 chars): ${trimmedToken.substring(0, 50)}...`);
      this.logger.log(`Token length: ${trimmedToken.length} chars (original: ${token.length} chars)`);

      // Calculate expiry time using 'expiration' field (per official API doc v2.9)
      // Fallback to 'expires_in' for compatibility, default to 12 hours (43200 seconds) if not provided
      // Per doc v2.4: "Token expiration time is set to 12 hours"
      const expiresIn = response.data.expiration || response.data.expires_in || 43200; // seconds
      
      // Store token in Redis with expiration (subtract buffer to refresh before expiry)
      const redisExpiration = expiresIn - (this.tokenRefreshBuffer / 1000); // Convert buffer to seconds
      
      try {
        await this.redisService.set(REDIS_TOKEN_KEY, trimmedToken, redisExpiration);
        this.logger.log(`✅ Dialog eSMS token refreshed successfully and stored in Redis.`);
        this.logger.log(`   Redis Key: ${REDIS_TOKEN_KEY}`);
        this.logger.log(`   Token stored with TTL: ${redisExpiration} seconds (${Math.floor(redisExpiration / 60)} minutes)`);
        this.logger.log(`   Token expires in: ${expiresIn} seconds (${Math.floor(expiresIn / 60)} minutes)`);
        
        // Verify it was stored
        const verifyToken = await this.redisService.get(REDIS_TOKEN_KEY);
        const verifyTtl = await this.redisService.ttl(REDIS_TOKEN_KEY);
        if (verifyToken) {
          this.logger.log(`   ✅ Verified: Token exists in Redis (TTL: ${verifyTtl} seconds)`);
        } else {
          this.logger.error(`   ❌ Warning: Token not found in Redis after storage!`);
        }
      } catch (redisError: any) {
        this.logger.error(`❌ Failed to store token in Redis: ${redisError.message}`);
        this.logger.error(`   Error details: ${JSON.stringify(redisError)}`);
        // Continue even if Redis fails - token is still valid
      }

      this.logger.log(`   Full Token: ${trimmedToken}`);

      return token;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        this.logger.error(
          `Failed to refresh Dialog eSMS token. Status: ${axiosError.response.status}, Data: ${JSON.stringify(axiosError.response.data)}`,
        );
        throw new Error(
          `Dialog eSMS authentication failed: ${axiosError.response.status} - ${JSON.stringify(axiosError.response.data)}`,
        );
      } else if (axiosError.request) {
        this.logger.error('Failed to refresh Dialog eSMS token. No response received.');
        throw new Error('Dialog eSMS authentication failed: No response from server');
      } else {
        this.logger.error(`Failed to refresh Dialog eSMS token: ${axiosError.message}`);
        throw new Error(`Dialog eSMS authentication failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * Get message status by transaction ID
   */
  getMessageStatus(transactionId: string): MessageStatus | null {
    return this.messageStatusMap.get(transactionId) || null;
  }

  /**
   * Get all message statuses (for debugging/monitoring)
   */
  getAllMessageStatuses(): MessageStatus[] {
    return Array.from(this.messageStatusMap.values());
  }

  /**
   * Update message status from delivery report
   */
  updateMessageStatus(
    transactionId: string,
    status: 'DELIVERED' | 'FAILED' | 'PENDING',
    statusDescription?: string,
    errorCode?: string,
    errorMessage?: string,
  ): void {
    const existing = this.messageStatusMap.get(transactionId);
    if (existing) {
      existing.status = status;
      existing.statusDescription = statusDescription;
      existing.errorCode = errorCode;
      existing.errorMessage = errorMessage;
      if (status === 'DELIVERED') {
        existing.deliveredAt = new Date();
      }
      this.messageStatusMap.set(transactionId, existing);
    }
  }

  /**
   * Send SMS via Dialog eSMS API
   * Returns detailed result including transaction ID and status
   * @param phone - Phone number to send SMS to
   * @param message - SMS message content
   * @param userIdentifier - Optional unique identifier (e.g., reservationId, userId) to ensure unique transaction IDs per user
   */
  async sendSmsViaDialog(phone: string, message: string, userIdentifier?: string): Promise<SmsSendResult> {
    const timestamp = new Date();
    
    if (!this.isEnabled()) {
      this.logger.warn('Dialog eSMS is disabled. Skipping SMS send.');
      return {
        success: false,
        phone,
        formattedPhone: phone,
        message,
        error: 'Dialog eSMS is disabled',
        timestamp,
      };
    }

    try {
      // Format phone number - Dialog eSMS requires 9-digit mobile numbers (7XXXXXXXX format)
      // Keep number as-is if already in correct format (e.g., "779132038")
      // Remove all non-digit characters first
      let formattedPhone = phone.replace(/\D/g, '');
      
      this.logger.log(`📱 Phone number formatting - Original: "${phone}", After removing non-digits: "${formattedPhone}"`);
      
      // Only modify if it's not already in the correct format (9 digits starting with 7)
      if (!(formattedPhone.length === 9 && formattedPhone.startsWith('7'))) {
        // Remove country code if present (94 or +94)
        if (formattedPhone.startsWith('94') && formattedPhone.length > 9) {
          formattedPhone = formattedPhone.substring(2);
          this.logger.log(`   Removed country code 94, now: "${formattedPhone}"`);
        }
        
        // Remove leading 0 if present (Sri Lankan mobile numbers start with 0 or 7)
        if (formattedPhone.startsWith('0')) {
          formattedPhone = formattedPhone.substring(1);
          this.logger.log(`   Removed leading 0, now: "${formattedPhone}"`);
        }
      }
      
      // Validate: Should be exactly 9 digits starting with 7
      if (formattedPhone.length !== 9 || !formattedPhone.startsWith('7')) {
        throw new Error(`Invalid phone number format. Expected 9-digit number starting with 7, got: ${formattedPhone} (length: ${formattedPhone.length})`);
      }
      
      this.logger.log(`✅ Final formatted phone number: "${formattedPhone}"`);

      // Get authentication token and ensure it's trimmed
      const token = (await this.getToken()).trim();

      // Generate unique transaction ID per user
      // Requirements: Unique integer between 1 and 18 digits
      // Combine timestamp, phone number hash, and user identifier to ensure uniqueness
      const timestampPart = Date.now();
      const phoneHash = this.hashString(formattedPhone) % 1000; // 3-digit hash from phone (0-999)
      const identifierHash = userIdentifier ? this.hashString(userIdentifier) % 1000 : Math.floor(Math.random() * 1000); // 3-digit hash (0-999)
      
      // Create a unique numeric transaction ID within 1-18 digit limit
      // Format: timestamp (11 digits max) + phoneHash (3 digits) + identifierHash (3 digits) = 17 digits max (safe within 18)
      // Use modulo to ensure timestamp part doesn't exceed 11 digits for safety
      const maxTimestampDigits = 11; // Keep timestamp at 11 digits max to ensure total stays within 18 digits
      const timestampModulo = Math.pow(10, maxTimestampDigits); // 10^11 = 100,000,000,000
      const timestampComponent = timestampPart % timestampModulo; // 11 digits max
      
      // Combine: timestamp*1000000 (17 digits max) + phoneHash*1000 (6 digits) + identifierHash (3 digits)
      // Example: 99,999,999,999 * 1,000,000 = 99,999,999,999,000,000 (17 digits)
      //          + 999,000 (6 digits) + 999 (3 digits) = 99,999,999,999,999,999 (17 digits max)
      // This ensures we stay well within the 18-digit limit
      let transactionId = timestampComponent * 1000000 + phoneHash * 1000 + identifierHash;
      
      // Validate: Ensure transaction ID is between 1 and 18 digits
      const transactionIdStr = transactionId.toString();
      if (transactionIdStr.length > 18) {
        // Fallback: Use modulo to ensure it's within 18 digits
        const max18Digits = Math.pow(10, 18) - 1; // 999999999999999999
        transactionId = transactionId % max18Digits;
        this.logger.warn(`Transaction ID exceeded 18 digits, using modulo: ${transactionId}`);
      }
      
      // Ensure transaction ID is at least 1 digit (not zero)
      if (transactionId === 0) {
        transactionId = 1;
        this.logger.warn(`Transaction ID was zero, setting to 1`);
      }

      // Prepare request payload (per Dialog eSMS API v2.9 specification)
      // Exact format matching Dialog API requirements with correct field order:
      // {
      //   "msisdn": [{ "mobile": "779132038" }],
      //   "sourceAddress": "Amila K",
      //   "message": "Test Message",
      //   "transaction_id": 1765632864089,
      //   "payment_method": 0
      // }
      // Field names must match exactly: msisdn, sourceAddress, message, transaction_id, payment_method
      // Mandatory fields: Authorization (in header), msisdn, message, transaction_id
      // transaction_id must be an integer (number) in the JSON body
      
      // Get sender ID
      const senderId = this.getSenderId();
      
      // Build payload with fields in the exact order specified
      const payload: any = {
        msisdn: [
          {
            mobile: formattedPhone, // 9-digit number starting with 7 (e.g., "779132038")
          },
        ],
        sourceAddress: senderId && senderId.trim() !== '' ? senderId.trim() : '', // Sender ID (e.g., "Amila K")
        message: message, // Will be cleaned and validated below - dynamic per user
        transaction_id: transactionId, // Will be converted to number below - unique per user (1-18 digits)
        payment_method: 0, // Payment method (0 = prepaid)
      };

      // Validate mandatory fields
      if (!formattedPhone) {
        throw new Error('Phone number is required');
      }
      
      // Validate and clean message
      const cleanedMessage = message.trim();
      if (!cleanedMessage || cleanedMessage === '') {
        throw new Error('Message is required and cannot be empty');
      }
      
      if (!transactionId || isNaN(Number(transactionId))) {
        throw new Error('Valid transaction ID (number) is required');
      }
      
      if (!token) {
        throw new Error('Authorization token is required');
      }
      
      // Warn if message is too long (SMS limit is typically 160 characters per segment, 1600 max)
      if (cleanedMessage.length > 1600) {
        this.logger.warn(`⚠️  Message length (${cleanedMessage.length}) exceeds recommended limit (1600 characters)`);
      }
      
      // Update payload with cleaned message and transaction_id as integer
      payload.message = cleanedMessage;
      payload.transaction_id = Number(transactionId);
      
      // Ensure transaction_id is a proper integer (not string)
      if (isNaN(payload.transaction_id) || payload.transaction_id <= 0) {
        throw new Error(`Invalid transaction_id: ${payload.transaction_id}. Must be a positive integer.`);
      }
      
      // Validate all mandatory fields are present
      if (!payload.msisdn || !Array.isArray(payload.msisdn) || payload.msisdn.length === 0) {
        throw new Error('msisdn array is required and must contain at least one mobile number');
      }
      if (!payload.msisdn[0].mobile) {
        throw new Error('msisdn[0].mobile is required');
      }
      if (!payload.message || payload.message.trim() === '') {
        throw new Error('message is required and cannot be empty');
      }
      if (!payload.transaction_id || isNaN(payload.transaction_id)) {
        throw new Error('transaction_id is required and must be a valid integer');
      }
      
      this.logger.log(`✅ Payload validation passed - All required fields present`);

      this.logger.log(`Sending SMS via Dialog eSMS to ${formattedPhone}...`);
      this.logger.log(`📤 Request Details:`);
      this.logger.log(`   Phone: ${formattedPhone}`);
      if (senderId && senderId.trim() !== '') {
        this.logger.log(`   Sender ID: "${senderId.trim()}"`);
      } else {
        this.logger.log(`   Sender ID: Not included (optional)`);
      }
      this.logger.log(`   Message Length: ${message.length} characters`);
      this.logger.log(`   Transaction ID: ${transactionId} (${transactionId.toString().length} digits, unique per user)`);
      if (userIdentifier) {
        this.logger.log(`   User Identifier: ${userIdentifier}`);
      }
      this.logger.log(`   Payment Method: 0 (prepaid)`);
      this.logger.log(`   Authorization Token (full): ${token}`);
      this.logger.log(`📤 Request Payload (Final):`);
      this.logger.log(`   msisdn: ${JSON.stringify(payload.msisdn)}`);
      this.logger.log(`   message: "${payload.message.substring(0, 100)}${payload.message.length > 100 ? '...' : ''}" (${payload.message.length} chars)`);
      this.logger.log(`   transaction_id: ${payload.transaction_id} (type: ${typeof payload.transaction_id})`);
      this.logger.log(`   sourceAddress: ${payload.sourceAddress ? `"${payload.sourceAddress}"` : 'NOT SET'}`);
      this.logger.log(`   payment_method: ${payload.payment_method}`);
      this.logger.log(`📤 Full Request Payload JSON:`);
      this.logger.log(JSON.stringify(payload, null, 2));

      // Prepare headers - ensure token is trimmed and Authorization format is correct
      const cleanToken = token.trim();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanToken}`, // Use quotes to ensure exact format
      };
      
      this.logger.log(`📤 Request Headers:`);
      this.logger.log(`   Content-Type: ${headers['Content-Type']}`);
      this.logger.log(`   Authorization: Bearer ${token}`);

      // Log the exact request being sent
      this.logger.log(`📤 Sending POST request to: ${this.baseUrl}/sms`);
      this.logger.log(`📤 Request Headers (including Authorization):`);
      this.logger.log(`   Authorization: Bearer ${cleanToken.substring(0, 20)}... (full token: ${cleanToken.length} chars)`);
      this.logger.log(`📤 Request Body (exact JSON):`);
      this.logger.log(JSON.stringify(payload));
      
      // Send request with explicit JSON serialization
      const response = await axios.post<DialogEsmsSendResponse>(
        `${this.baseUrl}/sms`,
        payload,
        {
          headers,
          timeout: 30000,
          // Ensure axios doesn't modify the payload
          transformRequest: [(data) => JSON.stringify(data)],
        },
      );
      
      this.logger.log(`📥 Response received - Status: ${response.status}`);
      this.logger.log(`📥 Response data: ${JSON.stringify(response.data)}`);

      // Check response status (per official API doc v2.9)
      const success = response.data.status === 'success';
      // Use API response transaction_id if available, otherwise use the one we generated
      const apiTransactionId = response.data.transaction_id || response.data.data?.campaignId || transactionId.toString();
      const comment = response.data.comment || response.data.message || '';

      // Store message status (convert to string for consistency)
      const messageStatus: MessageStatus = {
        transactionId: apiTransactionId.toString(),
        phone: formattedPhone,
        status: success ? 'SENT' : 'FAILED',
        sentAt: timestamp,
        statusDescription: comment,
        errorCode: success ? undefined : (response.data.errCode?.toString() || 'UNKNOWN'),
        errorMessage: success ? undefined : comment,
      };
      this.messageStatusMap.set(apiTransactionId.toString(), messageStatus);

      if (success) {
        this.logger.log(
          `✅ SMS sent successfully via Dialog eSMS. Transaction ID: ${apiTransactionId}`,
        );
        return {
          success: true,
          transactionId: apiTransactionId.toString(),
          phone,
          formattedPhone,
          message,
          timestamp,
        };
      } else {
        messageStatus.status = 'FAILED';
        const errCode = response.data.errCode || 'UNKNOWN';
        messageStatus.errorCode = errCode.toString();
        messageStatus.errorMessage = comment || 'API returned failure';
        this.logger.error(
          `Dialog eSMS API returned failure. Status: ${response.data.status}, Comment: ${comment}, Error Code: ${errCode}, Response: ${JSON.stringify(response.data)}`,
        );
        return {
          success: false,
          transactionId: apiTransactionId.toString(),
          phone,
          formattedPhone,
          message,
          error: `${comment} (Error Code: ${errCode})`,
          timestamp,
        };
      }
      } catch (error) {
      const axiosError = error as AxiosError;
      
      // If it's an authentication error (401), try refreshing token once
      if (axiosError.response?.status === 401) {
        this.logger.warn('Received 401 Unauthorized. Refreshing token and retrying...');
        this.logger.warn(`401 Error Details: ${JSON.stringify(axiosError.response?.data || {})}`);
        
        // Get current token from Redis for logging
        try {
          const currentToken = await this.redisService.get(REDIS_TOKEN_KEY);
          if (currentToken) {
            this.logger.warn(`Token used (first 50 chars): ${currentToken.substring(0, 50)}...`);
          }
        } catch (err) {
          // Ignore Redis errors for logging
        }
        
        // Clear invalid token from Redis
        try {
          await this.redisService.del(REDIS_TOKEN_KEY);
          this.logger.log('Cleared invalid token from Redis');
        } catch (redisError: any) {
          this.logger.warn(`Failed to clear token from Redis: ${redisError.message}`);
        }
        
        try {
          const newToken = await this.refreshToken();
          
          // Retry the request with new token - format phone number (9 digits starting with 7)
          let formattedPhone = phone.replace(/\D/g, '');
          
          // Remove country code if present (94 or +94)
          if (formattedPhone.startsWith('94') && formattedPhone.length > 9) {
            formattedPhone = formattedPhone.substring(2);
          }
          
          // Remove leading 0 if present
          if (formattedPhone.startsWith('0')) {
            formattedPhone = formattedPhone.substring(1);
          }
          
          // Validate format
          if (formattedPhone.length !== 9 || !formattedPhone.startsWith('7')) {
            throw new Error(`Invalid phone number format for retry. Expected 9-digit number starting with 7, got: ${formattedPhone}`);
          }

          // Generate unique transaction ID for retry (same method as original)
          // Requirements: Unique integer between 1 and 18 digits
          const retryTimestampPart = Date.now();
          const retryPhoneHash = this.hashString(formattedPhone) % 1000; // 3-digit hash (0-999)
          const retryIdentifierHash = userIdentifier ? this.hashString(userIdentifier) % 1000 : Math.floor(Math.random() * 1000); // 3-digit hash (0-999)
          
          // Create transaction ID within 1-18 digit limit (same as original)
          const maxTimestampDigits = 11; // Keep timestamp at 11 digits max to ensure total stays within 18 digits
          const timestampModulo = Math.pow(10, maxTimestampDigits); // 10^11 = 100,000,000,000
          const retryTimestampComponent = retryTimestampPart % timestampModulo; // 11 digits max
          let retryTransactionId = retryTimestampComponent * 1000000 + retryPhoneHash * 1000 + retryIdentifierHash;
          
          // Validate: Ensure transaction ID is between 1 and 18 digits
          const retryTransactionIdStr = retryTransactionId.toString();
          if (retryTransactionIdStr.length > 18) {
            const max18Digits = Math.pow(10, 18) - 1;
            retryTransactionId = retryTransactionId % max18Digits;
            this.logger.warn(`Retry transaction ID exceeded 18 digits, using modulo: ${retryTransactionId}`);
          }
          
          // Ensure transaction ID is at least 1 digit (not zero)
          if (retryTransactionId === 0) {
            retryTransactionId = 1;
            this.logger.warn(`Retry transaction ID was zero, setting to 1`);
          }

          // Prepare retry payload with mandatory fields only
          // transaction_id must be an integer (number) in the JSON body
          // Build payload with fields in the exact order specified
          const retrySenderId = this.getSenderId();
          const retryPayload: any = {
            msisdn: [
              {
                mobile: formattedPhone,
              },
            ],
            sourceAddress: retrySenderId && retrySenderId.trim() !== '' ? retrySenderId.trim() : '', // Sender ID
            message: message.trim(), // Ensure message is properly trimmed
            transaction_id: Number(retryTransactionId), // Ensure it's a number/integer
            payment_method: 0,
          };

          this.logger.log(`📤 Retry Request Headers (including Authorization):`);
          this.logger.log(`   Authorization: Bearer ${newToken.substring(0, 20)}... (full token: ${newToken.length} chars)`);
          this.logger.log(`📤 Retry Request Body (exact JSON):`);
          this.logger.log(JSON.stringify(retryPayload));

          // Ensure retry token is trimmed
          const cleanRetryToken = newToken.trim();
          const retryResponse = await axios.post<DialogEsmsSendResponse>(
            `${this.baseUrl}/sms`,
            retryPayload,
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cleanRetryToken}`, // Use quotes to ensure exact format
              },
              timeout: 30000,
            },
          );

          // Check response status (per official API doc v2.9)
          const retrySuccess = retryResponse.data.status === 'success';
          // Use API response transaction_id if available, otherwise use the one we generated
          const retryApiTransactionId = retryResponse.data.transaction_id || retryResponse.data.data?.campaignId || retryTransactionId.toString();
          const retryComment = retryResponse.data.comment || retryResponse.data.message || '';

          // Store message status (convert to string for consistency)
          const retryMessageStatus: MessageStatus = {
            transactionId: retryApiTransactionId.toString(),
            phone: formattedPhone,
            status: retrySuccess ? 'SENT' : 'FAILED',
            sentAt: timestamp,
            statusDescription: retryComment,
            errorCode: retrySuccess ? undefined : (retryResponse.data.errCode?.toString() || 'UNKNOWN'),
            errorMessage: retrySuccess ? undefined : retryComment,
          };
          this.messageStatusMap.set(retryApiTransactionId.toString(), retryMessageStatus);

          if (retrySuccess) {
            this.logger.log(`✅ SMS sent successfully via Dialog eSMS after token refresh. Transaction ID: ${retryApiTransactionId}`);
            return {
              success: true,
              transactionId: retryApiTransactionId.toString(),
              phone,
              formattedPhone,
              message,
              timestamp,
            };
          } else {
            retryMessageStatus.status = 'FAILED';
            const retryErrCode = retryResponse.data.errCode || 'UNKNOWN';
            retryMessageStatus.errorCode = retryErrCode.toString();
            retryMessageStatus.errorMessage = retryComment || 'API returned failure after retry';
            this.logger.error(
              `Dialog eSMS API returned failure after retry. Status: ${retryResponse.data.status}, Comment: ${retryComment}, Error Code: ${retryErrCode}, Response: ${JSON.stringify(retryResponse.data)}`,
            );
            return {
              success: false,
              transactionId: retryApiTransactionId.toString(),
              phone,
              formattedPhone,
              message,
              error: `${retryComment} (Error Code: ${retryErrCode})`,
              timestamp,
            };
          }
        } catch (retryError: any) {
          this.logger.error(`Failed to send SMS after token refresh: ${retryError}`);
          // Format phone for error response
          let errorFormattedPhone = phone.replace(/\D/g, '');
          if (errorFormattedPhone.startsWith('0')) {
            errorFormattedPhone = '94' + errorFormattedPhone.substring(1);
          } else if (!errorFormattedPhone.startsWith('94')) {
            errorFormattedPhone = '94' + errorFormattedPhone;
          }
          return {
            success: false,
            phone,
            formattedPhone: errorFormattedPhone,
            message,
            error: retryError?.message || 'Failed after token refresh',
            timestamp,
          };
        }
      }

      // Log other errors
      let errorMessage = 'Unknown error';
        // Format phone for error response
        let errorFormattedPhone = phone.replace(/\D/g, '');
        if (errorFormattedPhone.startsWith('94') && errorFormattedPhone.length > 9) {
          errorFormattedPhone = errorFormattedPhone.substring(2);
        }
        if (errorFormattedPhone.startsWith('0')) {
          errorFormattedPhone = errorFormattedPhone.substring(1);
        }

      if (axiosError.response) {
        const errorData: any = axiosError.response.data || {};
        const errCode = errorData?.errCode || errorData?.errorCode || 'UNKNOWN';
        const comment = errorData?.comment || errorData?.message || 'Unknown error';
        
        errorMessage = `HTTP ${axiosError.response.status}: Error Code ${errCode} - ${comment}`;
        
        this.logger.error(`❌ Failed to send SMS via Dialog eSMS`);
        this.logger.error(`   HTTP Status: ${axiosError.response.status}`);
        this.logger.error(`   Error Code: ${errCode}`);
        this.logger.error(`   Error Comment: ${comment}`);
        this.logger.error(`   Request URL: ${axiosError.config?.url}`);
        this.logger.error(`   Request Method: ${axiosError.config?.method?.toUpperCase()}`);
        this.logger.error(`   Request Headers Sent: ${JSON.stringify(axiosError.config?.headers || {})}`);
        this.logger.error(`   Request Body Sent: ${JSON.stringify(axiosError.config?.data || {})}`);
        this.logger.error(`   Full Error Response: ${JSON.stringify(errorData, null, 2)}`);
        
        // Common error code meanings (per Dialog eSMS API documentation)
        if (errCode === 101 || errCode === '101') {
          this.logger.error(`   ⚠️  Error 101 Diagnosis:`);
          this.logger.error(`      - Most common cause: Invalid or unregistered Sender ID`);
          this.logger.error(`      - Check ESMS_SENDER_ID in environment variables`);
          this.logger.error(`      - Verify sender ID is registered in Dialog eSMS dashboard`);
          this.logger.error(`      - Sender ID format: Should be alphanumeric, max 11 characters`);
          this.logger.error(`      - Current Sender ID: "${this.getSenderId()}"`);
          this.logger.error(`   Other possible causes:`);
          this.logger.error(`      - Invalid phone number format`);
          this.logger.error(`      - Missing required parameters`);
          this.logger.error(`      - Invalid message content`);
        }
      } else if (axiosError.request) {
        errorMessage = 'No response received from server';
        this.logger.error('Failed to send SMS via Dialog eSMS. No response received.');
      } else {
        errorMessage = axiosError.message;
        this.logger.error(`Failed to send SMS via Dialog eSMS: ${axiosError.message}`);
      }

      return {
        success: false,
        phone,
        formattedPhone: errorFormattedPhone,
        message,
        error: errorMessage,
        timestamp,
      };
    }
  }
}

