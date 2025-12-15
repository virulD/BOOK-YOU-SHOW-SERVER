import { Controller, Post, Body, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DialogEsmsService } from './dialog-esms.service';
import { RedisService } from '../redis/redis.service';

interface DeliveryReportDto {
  transaction_id?: string;
  msisdn?: string;
  mobile?: string;
  status?: string;
  status_code?: string;
  status_description?: string;
  delivery_time?: string;
  error_code?: string;
  error_message?: string;
  [key: string]: any;
}

@ApiTags('esms')
@Controller('api/esms')
export class DialogEsmsController {
  private readonly logger = new Logger(DialogEsmsController.name);

  constructor(
    private readonly dialogEsmsService: DialogEsmsService,
    private readonly redisService: RedisService,
  ) {}

  @Post('delivery-report')
  @ApiOperation({ summary: 'Receive delivery reports from Dialog eSMS' })
  @ApiResponse({ status: 200, description: 'Delivery report received successfully' })
  async handleDeliveryReport(@Body() report: DeliveryReportDto) {
    this.logger.log('📨 Received delivery report from Dialog eSMS');
    this.logger.log(`   Transaction ID: ${report.transaction_id || 'N/A'}`);
    this.logger.log(`   MSISDN: ${report.msisdn || report.mobile || 'N/A'}`);
    this.logger.log(`   Status: ${report.status || report.status_code || 'N/A'}`);
    this.logger.log(`   Status Description: ${report.status_description || report.error_message || 'N/A'}`);
    this.logger.log(`   Delivery Time: ${report.delivery_time || 'N/A'}`);
    
    if (report.error_code) {
      this.logger.warn(`   Error Code: ${report.error_code}`);
    }

    // Log full report for debugging
    this.logger.debug(`   Full report: ${JSON.stringify(report, null, 2)}`);

    // Map common status codes
    const status = report.status || report.status_code || 'UNKNOWN';
    const statusDescription = report.status_description || report.error_message || '';

    // Update message status in service
    if (report.transaction_id) {
      if (status === 'DELIVERED' || status === 'DELIVRD' || status === '0') {
        this.dialogEsmsService.updateMessageStatus(
          report.transaction_id,
          'DELIVERED',
          statusDescription,
        );
        this.logger.log(`✅ SMS delivered successfully to ${report.msisdn || report.mobile}`);
      } else if (status === 'FAILED' || status === 'REJECTED' || status.startsWith('ERR')) {
        this.dialogEsmsService.updateMessageStatus(
          report.transaction_id,
          'FAILED',
          statusDescription,
          report.error_code,
          report.error_message,
        );
        this.logger.warn(`❌ SMS delivery failed for ${report.msisdn || report.mobile}: ${statusDescription}`);
      } else {
        this.dialogEsmsService.updateMessageStatus(
          report.transaction_id,
          'PENDING',
          statusDescription,
        );
        this.logger.log(`ℹ️  SMS status update for ${report.msisdn || report.mobile}: ${status} - ${statusDescription}`);
      }
    }

    // Return success response
    return {
      status: 'OK',
      received: true,
      transaction_id: report.transaction_id,
    };
  }

  @Get('status/:transactionId')
  @ApiOperation({ summary: 'Get SMS message status by transaction ID' })
  @ApiResponse({ status: 200, description: 'Message status retrieved successfully' })
  async getMessageStatus(@Param('transactionId') transactionId: string) {
    const status = this.dialogEsmsService.getMessageStatus(transactionId);
    
    if (!status) {
      return {
        found: false,
        message: 'Transaction ID not found',
        transactionId,
      };
    }

    return {
      found: true,
      transactionId: status.transactionId,
      phone: status.phone,
      status: status.status,
      statusDescription: status.statusDescription,
      sentAt: status.sentAt,
      deliveredAt: status.deliveredAt,
      errorCode: status.errorCode,
      errorMessage: status.errorMessage,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get all SMS message statuses (for monitoring)' })
  @ApiResponse({ status: 200, description: 'All message statuses retrieved successfully' })
  async getAllMessageStatuses() {
    const statuses = this.dialogEsmsService.getAllMessageStatuses();
    return {
      count: statuses.length,
      messages: statuses,
    };
  }

  @Post('test')
  @ApiOperation({ summary: 'Test SMS sending with user ID 16541' })
  @ApiResponse({ status: 200, description: 'Test SMS sent successfully' })
  async testSms(@Body() body: { phone: string; message?: string }) {
    const { phone, message = 'Test Message' } = body;
    const userId = '16541'; // Use user ID 16541 as requested
    
    this.logger.log(`🧪 Testing SMS send with user ID: ${userId}`);
    this.logger.log(`   Phone: ${phone}`);
    this.logger.log(`   Message: ${message}`);
    
    const result = await this.dialogEsmsService.sendSmsViaDialog(phone, message, userId);
    
    return {
      success: result.success,
      transactionId: result.transactionId,
      phone: result.phone,
      formattedPhone: result.formattedPhone,
      message: result.message,
      error: result.error,
      timestamp: result.timestamp,
      userId: userId,
    };
  }

  @Get('token/refresh')
  @ApiOperation({ summary: 'Manually refresh and store Dialog eSMS token in Redis' })
  @ApiResponse({ status: 200, description: 'Token refreshed and stored' })
  async refreshToken() {
    this.logger.log('🔄 Manually refreshing Dialog eSMS token...');
    const token = await this.dialogEsmsService.refreshToken();
    
    return {
      success: true,
      message: 'Token refreshed and stored in Redis',
      tokenPreview: token.substring(0, 50) + '...',
      tokenLength: token.length,
      redisKey: 'dialog_esms:token',
    };
  }

  @Get('token/check')
  @ApiOperation({ summary: 'Check if token exists in Redis' })
  @ApiResponse({ status: 200, description: 'Token status retrieved' })
  async checkToken() {
    const redisKey = 'dialog_esms:token';
    const token = await this.redisService.get(redisKey);
    const ttl = await this.redisService.ttl(redisKey);
    
    return {
      exists: !!token,
      ttl: ttl > 0 ? ttl : null,
      ttlSeconds: ttl > 0 ? ttl : null,
      ttlMinutes: ttl > 0 ? Math.floor(ttl / 60) : null,
      ttlHours: ttl > 0 ? Math.floor(ttl / 3600) : null,
      tokenPreview: token ? token.substring(0, 50) + '...' : null,
      tokenLength: token ? token.length : 0,
      redisKey: redisKey,
    };
  }
}

