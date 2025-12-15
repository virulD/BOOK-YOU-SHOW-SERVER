import { Controller, Post, Body, Logger, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DialogEsmsService } from '../dialog-esms/dialog-esms.service';
import { SmsService } from './sms.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

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

@ApiTags('sms')
@Controller('api/sms')
export class SmsController {
  private readonly logger = new Logger(SmsController.name);

  constructor(
    private readonly dialogEsmsService: DialogEsmsService,
    private readonly smsService: SmsService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  @Post('dlr')
  @ApiOperation({ summary: 'Receive delivery reports (DLR) from Dialog eSMS' })
  @ApiResponse({ status: 200, description: 'Delivery report received successfully' })
  async handleDeliveryReport(@Body() report: DeliveryReportDto) {
    this.logger.log('📨 Received delivery report (DLR) from Dialog eSMS');
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

    // TODO: Update MongoDB or Firestore if needed
    // Example:
    // await this.bookingsService.updateSmsDeliveryStatus(report.transaction_id, status);

    // Return success response
    return {
      status: 'OK',
      received: true,
      transaction_id: report.transaction_id,
    };
  }

  @Post('test-send')
  @ApiOperation({ 
    summary: 'Test SMS sending with Firestore document data',
    description: 'Sends SMS using data from a Firestore document and updates status to success',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phone', 'message', 'eventName', 'venue', 'seats'],
      properties: {
        phone: { type: 'string', example: '0779132038' },
        message: { type: 'string', example: 'Your booking is confirmed...' },
        eventName: { type: 'string', example: 'Event Name' },
        venue: { type: 'string', example: 'Venue Name' },
        seats: { type: 'array', items: { type: 'string' }, example: ['E8'] },
        eventId: { type: 'string', example: '6929bf01238d8bad27a26d4e' },
        reservationId: { type: 'string', example: 'reservation123' },
        eventDate: { type: 'string', format: 'date-time', example: '2024-01-15T10:00:00Z' },
        firestoreDocId: { type: 'string', description: 'Optional: Firestore document ID to update status' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'SMS sent successfully' })
  async testSendSms(@Body() body: {
    phone: string;
    message: string;
    eventName: string;
    venue: string;
    seats: string[];
    eventId?: string;
    reservationId?: string;
    eventDate?: string | Date;
    firestoreDocId?: string;
  }) {
    this.logger.log('🧪 ========== TEST SMS SENDING ==========');
    this.logger.log(`   Phone: ${body.phone}`);
    this.logger.log(`   Event: ${body.eventName}`);
    this.logger.log(`   Venue: ${body.venue}`);
    this.logger.log(`   Seats: ${body.seats.join(', ')}`);
    this.logger.log(`   Message: ${body.message}`);

    try {
      // Use provided reservationId or generate a test one
      const reservationId = body.reservationId || 'test-' + Date.now();
      const eventDate = body.eventDate ? new Date(body.eventDate) : new Date();

      // Send SMS
      const smsResult = await this.smsService.sendBookingConfirmation(
        body.phone,
        body.eventName,
        body.seats,
        reservationId,
        eventDate,
        body.venue,
      );

      // Update Firestore status if document ID is provided
      // Note: If SMS fails, we'll update status to 'failed'
      let firestoreUpdated = false;
      if (body.firestoreDocId) {
        try {
          const firestore = this.firebaseAdminService.getFirestore();
          if (firestore) {
            const updateData: any = {
              updatedAt: new Date(),
            };
            
            if (smsResult) {
              updateData.status = 'success';
              updateData.sentAt = new Date();
              this.logger.log(`✅ Updated Firestore document ${body.firestoreDocId} status to 'success'`);
            } else {
              updateData.status = 'failed';
              updateData.errorMessage = 'SMS sending failed via Dialog eSMS';
              this.logger.warn(`⚠️  Updated Firestore document ${body.firestoreDocId} status to 'failed'`);
            }
            
            await firestore
              .collection('pending_messages')
              .doc(body.firestoreDocId)
              .update(updateData);
            firestoreUpdated = true;
          } else {
            this.logger.warn(`⚠️  Firestore not available - cannot update status`);
          }
        } catch (firestoreError: any) {
          this.logger.error(`❌ Failed to update Firestore status: ${firestoreError.message}`);
        }
      }

      // Get transaction ID from Dialog eSMS service if available
      const allStatuses = this.dialogEsmsService.getAllMessageStatuses();
      const latestStatus = allStatuses.length > 0 ? allStatuses[allStatuses.length - 1] : null;

      return {
        success: smsResult,
        message: smsResult 
          ? 'SMS sent successfully' 
          : 'SMS sending failed (check logs for details)',
        reservationId,
        transactionId: latestStatus?.transactionId || null,
        smsStatus: latestStatus?.status || null,
        firestoreUpdated,
        firestoreDocId: body.firestoreDocId || null,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`❌ Test SMS sending failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('update-firestore-and-send')
  @ApiOperation({ 
    summary: 'Update Firestore document status and send SMS',
    description: 'Finds a Firestore document by phone/eventId, updates status to success, and sends SMS',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phone', 'eventId'],
      properties: {
        phone: { type: 'string', example: '0779132038' },
        eventId: { type: 'string', example: '6929bf01238d8bad27a26d4e' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Firestore updated and SMS sent' })
  async updateFirestoreAndSend(@Body() body: { phone: string; eventId: string }) {
    this.logger.log('🔄 ========== UPDATE FIRESTORE AND SEND SMS ==========');
    this.logger.log(`   Phone: ${body.phone}`);
    this.logger.log(`   Event ID: ${body.eventId}`);

    try {
      const firestore = this.firebaseAdminService.getFirestore();
      if (!firestore) {
        throw new Error('Firestore not available');
      }

      // Find the document in pending_messages collection
      // Note: Documents are now saved with status 'success' initially
      // So we search for either 'success' or 'pending' status
      const snapshot = await firestore
        .collection('pending_messages')
        .where('phone', '==', body.phone)
        .where('eventId', '==', body.eventId)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        return {
          success: false,
          error: 'No message found for this phone and eventId',
          phone: body.phone,
          eventId: body.eventId,
        };
      }

      const doc = snapshot.docs[0];
      const data = doc.data();
      this.logger.log(`📄 Found Firestore document: ${doc.id}`);
      this.logger.log(`   Current Status: ${data.status || 'unknown'}`);
      this.logger.log(`   Data: ${JSON.stringify(data, null, 2)}`);

      // Note: Status is already 'success' from initial save
      // We'll update it based on SMS sending result below

      // Send SMS using the data from Firestore
      const reservationId = 'firestore-' + doc.id;
      const eventDate = data.eventDate ? new Date(data.eventDate) : new Date();

      const smsResult = await this.smsService.sendBookingConfirmation(
        data.phone,
        data.eventName,
        data.seats || [],
        reservationId,
        eventDate,
        data.venue,
      );

      // Update Firestore status based on SMS result
      const updateData: any = {
        updatedAt: new Date(),
      };
      
      if (smsResult) {
        updateData.status = 'success';
        updateData.sentAt = new Date();
        this.logger.log(`✅ SMS sent successfully - Firestore document ${doc.id} status remains 'success'`);
      } else {
        updateData.status = 'failed';
        updateData.errorMessage = 'SMS sending failed via Dialog eSMS';
        this.logger.warn(`⚠️  SMS sending failed - Updated Firestore document ${doc.id} status to 'failed'`);
      }
      
      await doc.ref.update(updateData);

      // Get transaction ID
      const allStatuses = this.dialogEsmsService.getAllMessageStatuses();
      const latestStatus = allStatuses.length > 0 ? allStatuses[allStatuses.length - 1] : null;

      return {
        success: smsResult,
        message: smsResult ? 'SMS sent successfully' : 'SMS sending failed - status updated to failed',
        firestoreDocId: doc.id,
        firestoreStatus: updateData.status,
        transactionId: latestStatus?.transactionId || null,
        smsStatus: latestStatus?.status || null,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to update Firestore and send SMS: ${error.message}`);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('status/:transactionId')
  @ApiOperation({ summary: 'Get SMS status by transaction ID' })
  @ApiResponse({ status: 200, description: 'SMS status retrieved' })
  async getSmsStatus(@Param('transactionId') transactionId: string) {
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

  @Get('all-statuses')
  @ApiOperation({ summary: 'Get all SMS statuses (for debugging)' })
  @ApiResponse({ status: 200, description: 'All SMS statuses' })
  async getAllSmsStatuses() {
    const statuses = this.dialogEsmsService.getAllMessageStatuses();
    return {
      count: statuses.length,
      messages: statuses,
    };
  }

  @Get('test')
  @ApiOperation({ summary: 'Test endpoint to verify SMS controller is working' })
  @ApiResponse({ status: 200, description: 'Controller is working' })
  async testEndpoint() {
    return {
      success: true,
      message: 'SMS controller is working!',
      timestamp: new Date().toISOString(),
      endpoints: {
        testSend: 'POST /api/sms/test-send',
        updateAndSend: 'POST /api/sms/update-firestore-and-send',
        getStatus: 'GET /api/sms/status/:transactionId',
        allStatuses: 'GET /api/sms/all-statuses',
        dlr: 'POST /api/sms/dlr',
      },
    };
  }
}

