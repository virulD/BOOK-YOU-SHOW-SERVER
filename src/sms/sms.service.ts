import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DialogEsmsService } from '../dialog-esms/dialog-esms.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => DialogEsmsService))
    private dialogEsmsService: DialogEsmsService,
  ) {}

  async sendBookingConfirmation(
    phoneNumber: string,
    eventTitle: string,
    seatLabels: string[],
    reservationId: string,
    eventDate: Date,
    venueName: string,
  ): Promise<boolean> {
    try {
      // Pass phone number as-is to Dialog service - it will handle formatting
      // Dialog service expects 9-digit number starting with 7 (e.g., "779132038")
      // Don't add +94 or modify the number here - let Dialog service handle it

      // Generate simple SMS message
      const message = `Your booking is confirmed! Thank you!`;

      // Primary SMS Provider: Dialog eSMS
      try {
        this.logger.log(`Attempting to send SMS via Dialog eSMS to ${phoneNumber}...`);
        // Pass reservationId as user identifier to ensure unique transaction ID per user
        // Pass phone number as-is - Dialog service will format it to 9-digit format (e.g., "779132038")
        const result = await this.dialogEsmsService.sendSmsViaDialog(phoneNumber, message, reservationId);
        
        if (result.success) {
          this.logger.log(
            `✅ SMS sent successfully via Dialog eSMS to ${result.formattedPhone}. Transaction ID: ${result.transactionId || 'N/A'}`,
          );
          return true;
        } else {
          this.logger.warn(
            `Dialog eSMS returned failure for ${result.formattedPhone}. Error: ${result.error || 'Unknown error'}. Transaction ID: ${result.transactionId || 'N/A'}`,
          );
          // Fall through to backup/logging
        }
      } catch (error: any) {
        this.logger.warn(`Primary SMS (Dialog eSMS) failed. Error: ${error.message}`);
        this.logger.warn(`Falling back to logging only.`);
        // Fall through to backup/logging
      }

      // Backup: Log the SMS (for development/testing when Dialog eSMS is not available)
      this.logger.log(`SMS to ${phoneNumber} (logged only): ${message}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phoneNumber}:`, error);
      // Don't throw - SMS failure shouldn't break the booking
      return false;
    }
  }
}

