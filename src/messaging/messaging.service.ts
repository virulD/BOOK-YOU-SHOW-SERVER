import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as admin from 'firebase-admin';
import { DeviceToken, DeviceTokenDocument } from '../schemas/device-token.schema';
import { FCMMessage, FCMMessageDocument, MessageStatus } from '../schemas/fcm-message.schema';
import { SendFCMMessageDto } from '../dto/send-fcm-message.dto';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger(MessagingService.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor(
    private firebaseAdminService: FirebaseAdminService,
    @InjectModel(DeviceToken.name) private deviceTokenModel: Model<DeviceTokenDocument>,
    @InjectModel(FCMMessage.name) private fcmMessageModel: Model<FCMMessageDocument>,
  ) {}

  async onModuleInit() {
    // Wait a bit for Firebase to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (this.firebaseAdminService.isInitialized()) {
      this.messaging = this.firebaseAdminService.getMessaging();
      if (this.messaging) {
        this.logger.log('✅ FCM Messaging service initialized successfully');
      } else {
        this.logger.error('❌ FCM Messaging service is null - Firebase may not be properly initialized');
      }
    } else {
      this.logger.error('❌ Firebase Admin not initialized. FCM messaging will not be available.');
    }
  }

  /**
   * Get FCM token from database by phone number
   */
  async getFCMTokenByPhone(phoneNumber: string): Promise<string | null> {
    try {
      const deviceToken = await this.deviceTokenModel
        .findOne({ phoneNumber, isActive: true })
        .exec();

      if (deviceToken) {
        // Update last used timestamp
        deviceToken.lastUsedAt = new Date();
        await deviceToken.save();
        return deviceToken.fcmToken;
      }

      return null;
    } catch (error) {
      this.logger.error(`Error fetching FCM token for phone ${phoneNumber}:`, error);
      return null;
    }
  }

  /**
   * Register or update FCM token for a phone number
   */
  async registerDeviceToken(phoneNumber: string, fcmToken: string, deviceInfo?: string): Promise<DeviceTokenDocument> {
    try {
      const deviceToken = await this.deviceTokenModel.findOneAndUpdate(
        { phoneNumber },
        {
          fcmToken,
          isActive: true,
          deviceInfo,
          lastUsedAt: new Date(),
        },
        {
          upsert: true,
          new: true,
        },
      ).exec();

      this.logger.log(`Device token registered/updated for phone: ${phoneNumber}`);
      return deviceToken;
    } catch (error) {
      this.logger.error(`Error registering device token for phone ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Send FCM v1 message using Firebase Admin SDK
   */
  async sendFCMMessage(dto: SendFCMMessageDto): Promise<{ success: boolean; messageId?: string; dbMessageId?: string; error?: string }> {
    if (!this.messaging) {
      const error = 'FCM messaging service is not initialized';
      this.logger.error(error);
      return { success: false, error };
    }

    let messageRecord: FCMMessageDocument | null = null;

    try {
      // Get FCM token - use provided token or fetch from database
      let fcmToken: string | undefined = dto.fcmToken;

      if (!fcmToken) {
        const tokenFromDb = await this.getFCMTokenByPhone(dto.phone);
        if (!tokenFromDb) {
          const error = `No FCM token found for phone number: ${dto.phone}`;
          this.logger.warn(error);
          return { success: false, error };
        }
        fcmToken = tokenFromDb;
      }

      // Create message record in database first
      messageRecord = new this.fcmMessageModel({
        phoneNumber: dto.phone,
        fcmToken,
        message: dto.message,
        status: MessageStatus.PENDING,
      });
      await messageRecord.save();

      // Prepare FCM v1 message payload
      const message: admin.messaging.Message = {
        token: fcmToken,
        data: {
          phone: dto.phone,
          message: dto.message,
          messageId: messageRecord._id.toString(), // Include DB ID for acknowledgment
        },
        // Optional: Add notification for foreground apps
        notification: {
          title: 'New Message',
          body: dto.message,
        },
        // Android-specific options
        android: {
          priority: 'high',
          data: {
            phone: dto.phone,
            message: dto.message,
            messageId: messageRecord._id.toString(),
          },
        },
        // APNS (iOS) specific options
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              contentAvailable: true,
              sound: 'default',
            },
          },
        },
      };

      // Send the message using FCM v1 API
      const response = await this.messaging.send(message);

      // Update message record with FCM response
      messageRecord.fcmMessageId = response;
      messageRecord.status = MessageStatus.SENT;
      messageRecord.sentAt = new Date();
      messageRecord.fcmResponse = { messageId: response };
      await messageRecord.save();

      this.logger.log(`FCM message sent successfully. Message ID: ${response}, Phone: ${dto.phone}, DB ID: ${messageRecord._id}`);
      
      return {
        success: true,
        messageId: response,
        dbMessageId: messageRecord._id.toString(),
      };
    } catch (error: any) {
      this.logger.error(`Failed to send FCM message to ${dto.phone}:`, error);

      // Handle specific FCM errors
      let errorMessage = 'Failed to send FCM message';
      
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        errorMessage = 'Invalid or unregistered FCM token';
        // Optionally deactivate the token in database
        const tokenToDeactivate = dto.fcmToken || await this.getFCMTokenByPhone(dto.phone);
        if (tokenToDeactivate) {
          await this.deviceTokenModel.updateOne(
            { fcmToken: tokenToDeactivate },
            { isActive: false },
          ).exec();
        }
      } else if (error.code === 'messaging/invalid-argument') {
        errorMessage = 'Invalid message arguments';
      } else if (error.code === 'messaging/unavailable') {
        errorMessage = 'FCM service temporarily unavailable';
      }

      // Update message record with error
      if (messageRecord) {
        messageRecord.status = MessageStatus.FAILED;
        messageRecord.error = errorMessage;
        messageRecord.fcmResponse = { error: error.message, code: error.code };
        await messageRecord.save();
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Acknowledge message receipt from Flutter app
   */
  async acknowledgeMessage(messageId: string): Promise<boolean> {
    try {
      const message = await this.fcmMessageModel.findById(messageId).exec();
      if (!message) {
        this.logger.warn(`Message not found for acknowledgment: ${messageId}`);
        return false;
      }

      message.status = MessageStatus.ACKNOWLEDGED;
      message.acknowledgedAt = new Date();
      await message.save();

      this.logger.log(`Message acknowledged: ${messageId} for phone: ${message.phoneNumber}`);
      return true;
    } catch (error) {
      this.logger.error(`Error acknowledging message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Get message status by ID
   */
  async getMessageStatus(messageId: string): Promise<FCMMessageDocument | null> {
    try {
      return await this.fcmMessageModel.findById(messageId).exec();
    } catch (error) {
      this.logger.error(`Error fetching message status for ${messageId}:`, error);
      return null;
    }
  }

  /**
   * Get message history for a phone number
   */
  async getMessageHistory(phoneNumber: string, limit: number = 50): Promise<FCMMessageDocument[]> {
    try {
      return await this.fcmMessageModel
        .find({ phoneNumber })
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec();
    } catch (error) {
      this.logger.error(`Error fetching message history for ${phoneNumber}:`, error);
      return [];
    }
  }

  /**
   * Test Firebase connection
   */
  async testConnection(): Promise<boolean> {
    return this.messaging !== null;
  }

  /**
   * Get delivery statistics for a phone number
   */
  async getDeliveryStats(phoneNumber: string): Promise<{
    total: number;
    sent: number;
    delivered: number;
    acknowledged: number;
    failed: number;
  }> {
    try {
      const stats = await this.fcmMessageModel.aggregate([
        { $match: { phoneNumber } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]).exec();

      const result = {
        total: 0,
        sent: 0,
        delivered: 0,
        acknowledged: 0,
        failed: 0,
      };

      stats.forEach((stat) => {
        result.total += stat.count;
        switch (stat._id) {
          case MessageStatus.SENT:
            result.sent = stat.count;
            break;
          case MessageStatus.DELIVERED:
            result.delivered = stat.count;
            break;
          case MessageStatus.ACKNOWLEDGED:
            result.acknowledged = stat.count;
            break;
          case MessageStatus.FAILED:
            result.failed = stat.count;
            break;
        }
      });

      return result;
    } catch (error) {
      this.logger.error(`Error fetching delivery stats for ${phoneNumber}:`, error);
      return { total: 0, sent: 0, delivered: 0, acknowledged: 0, failed: 0 };
    }
  }

  /**
   * Send FCM message to multiple tokens (multicast)
   */
  async sendMulticastMessage(
    tokens: string[],
    phone: string,
    message: string,
  ): Promise<admin.messaging.BatchResponse> {
    if (!this.messaging) {
      throw new Error('FCM messaging service is not initialized');
    }

    const messagePayload: admin.messaging.MulticastMessage = {
      tokens,
      data: {
        phone,
        message,
      },
      notification: {
        title: 'New Message',
        body: message,
      },
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
      },
    };

    return await this.messaging.sendEachForMulticast(messagePayload);
  }
}

