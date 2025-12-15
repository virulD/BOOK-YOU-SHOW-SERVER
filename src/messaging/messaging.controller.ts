import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, BadRequestException, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MessagingService } from './messaging.service';
import { SendFCMMessageDto } from '../dto/send-fcm-message.dto';

@ApiTags('messaging')
@Controller('api')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post('send-sms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Send SMS via FCM push notification',
    description: 'Sends a push notification to a Flutter app with phone and message data. The app will receive the notification in the background and send the SMS.',
  })
  @ApiBody({ type: SendFCMMessageDto })
  @ApiResponse({ 
    status: 200, 
    description: 'FCM message sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        messageId: { type: 'string', example: 'projects/myproject/messages/0:1234567890' },
      },
    },
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - missing or invalid parameters',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'No FCM token found for phone number: 0771234567' },
      },
    },
  })
  async sendSMS(@Body() dto: SendFCMMessageDto) {
    // Validate input
    if (!dto.phone || !dto.message) {
      throw new BadRequestException('Phone number and message are required');
    }

    // Send FCM message
    const result = await this.messagingService.sendFCMMessage(dto);

    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to send FCM message');
    }

    return {
      success: true,
      messageId: result.messageId,
      dbMessageId: result.dbMessageId,
      message: 'FCM message sent successfully. The Flutter app will handle sending the SMS.',
    };
  }

  @Post('register-device-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Register or update FCM device token',
    description: 'Registers a new FCM token for a phone number or updates an existing one.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phoneNumber', 'fcmToken'],
      properties: {
        phoneNumber: { type: 'string', example: '0771234567' },
        fcmToken: { type: 'string', example: 'dGhpcyBpcyBhIGZha2UgZmNtIHRva2Vu...' },
        deviceInfo: { type: 'string', example: 'iPhone 13, iOS 16.0' },
      },
    },
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Device token registered successfully',
  })
  async registerDeviceToken(
    @Body() body: { phoneNumber: string; fcmToken: string; deviceInfo?: string },
  ) {
    if (!body.phoneNumber || !body.fcmToken) {
      throw new BadRequestException('Phone number and FCM token are required');
    }

    const deviceToken = await this.messagingService.registerDeviceToken(
      body.phoneNumber,
      body.fcmToken,
      body.deviceInfo,
    );

    return {
      success: true,
      message: 'Device token registered successfully',
      deviceToken: {
        phoneNumber: deviceToken.phoneNumber,
        isActive: deviceToken.isActive,
        lastUsedAt: deviceToken.lastUsedAt,
      },
    };
  }

  @Post('acknowledge-message/:messageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Acknowledge message receipt',
    description: 'Called by Flutter app to confirm that the message was received and processed.',
  })
  @ApiParam({ name: 'messageId', description: 'Database message ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ 
    status: 200, 
    description: 'Message acknowledged successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Message acknowledged successfully' },
      },
    },
  })
  async acknowledgeMessage(@Param('messageId') messageId: string) {
    const acknowledged = await this.messagingService.acknowledgeMessage(messageId);
    
    if (!acknowledged) {
      throw new BadRequestException('Message not found or already acknowledged');
    }

    return {
      success: true,
      message: 'Message acknowledged successfully',
    };
  }

  @Get('message-status/:messageId')
  @ApiOperation({ 
    summary: 'Get message delivery status',
    description: 'Check the current status of a sent message.',
  })
  @ApiParam({ name: 'messageId', description: 'Database message ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ 
    status: 200, 
    description: 'Message status retrieved successfully',
  })
  async getMessageStatus(@Param('messageId') messageId: string) {
    const message = await this.messagingService.getMessageStatus(messageId);
    
    if (!message) {
      throw new BadRequestException('Message not found');
    }

    return {
      success: true,
      message: {
        id: message._id,
        phoneNumber: message.phoneNumber,
        status: message.status,
        message: message.message,
        fcmMessageId: message.fcmMessageId,
        sentAt: message.sentAt,
        deliveredAt: message.deliveredAt,
        acknowledgedAt: message.acknowledgedAt,
        error: message.error,
        createdAt: message.createdAt,
      },
    };
  }

  @Get('message-history/:phoneNumber')
  @ApiOperation({ 
    summary: 'Get message history for a phone number',
    description: 'Retrieve all messages sent to a specific phone number.',
  })
  @ApiParam({ name: 'phoneNumber', description: 'Phone number', example: '0771234567' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of messages to return', example: 50 })
  @ApiResponse({ 
    status: 200, 
    description: 'Message history retrieved successfully',
  })
  async getMessageHistory(
    @Param('phoneNumber') phoneNumber: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const messages = await this.messagingService.getMessageHistory(phoneNumber, limitNum);

    return {
      success: true,
      count: messages.length,
      messages: messages.map((msg) => ({
        id: msg._id,
        phoneNumber: msg.phoneNumber,
        status: msg.status,
        message: msg.message,
        fcmMessageId: msg.fcmMessageId,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt,
        acknowledgedAt: msg.acknowledgedAt,
        error: msg.error,
        createdAt: msg.createdAt,
      })),
    };
  }

  @Get('delivery-stats/:phoneNumber')
  @ApiOperation({ 
    summary: 'Get delivery statistics for a phone number',
    description: 'Get aggregated statistics about message delivery for a phone number.',
  })
  @ApiParam({ name: 'phoneNumber', description: 'Phone number', example: '0771234567' })
  @ApiResponse({ 
    status: 200, 
    description: 'Delivery statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        stats: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 100 },
            sent: { type: 'number', example: 95 },
            delivered: { type: 'number', example: 90 },
            acknowledged: { type: 'number', example: 85 },
            failed: { type: 'number', example: 5 },
          },
        },
      },
    },
  })
  async getDeliveryStats(@Param('phoneNumber') phoneNumber: string) {
    const stats = await this.messagingService.getDeliveryStats(phoneNumber);

    return {
      success: true,
      phoneNumber,
      stats,
    };
  }

  @Get('test-firebase')
  @ApiOperation({ 
    summary: 'Test Firebase connection',
    description: 'Verify that Firebase Admin SDK is properly initialized and FCM is available.',
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Firebase status',
  })
  async testFirebase() {
    const messaging = this.messagingService['messaging'];
    const isInitialized = messaging !== null;
    
    return {
      success: true,
      firebaseInitialized: isInitialized,
      message: isInitialized 
        ? '✅ Firebase Admin SDK is initialized and FCM messaging is available'
        : '❌ Firebase Admin SDK is not initialized. Check server logs for errors.',
      note: 'FCM notifications do NOT appear in Firebase Console. They are sent directly to devices.',
    };
  }
}

