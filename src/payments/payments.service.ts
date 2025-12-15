import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import type { Response } from 'express';
import { SeatLock, SeatLockDocument, ReservationNumericState } from '../schemas/seat-lock.schema';
import { SeatLockBackup, SeatLockBackupDocument } from '../schemas/seat-lock-backup.schema';
import { Booking, BookingDocument, PaymentState } from '../schemas/booking.schema';
import { Seat, SeatDocument, SeatState } from '../schemas/seat.schema';
import { BookingsService } from '../bookings/bookings.service';
import { SeatsService } from '../seats/seats.service';
import { EventsService } from '../events/events.service';
import { ConfigService } from '@nestjs/config';
import { CreateDialogGeniePaymentDto, DialogGenieCustomerDto } from '../dto/dialog-genie-payment.dto';
import { FirebaseMessageService } from '../firebase-message/firebase-message.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(SeatLock.name) private seatLockModel: Model<SeatLockDocument>,
    @InjectModel(SeatLockBackup.name) private seatLockBackupModel: Model<SeatLockBackupDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    @InjectModel(Seat.name) private seatModel: Model<SeatDocument>,
    private bookingsService: BookingsService,
    private seatsService: SeatsService,
    private eventsService: EventsService,
    private configService: ConfigService,
    private firebaseMessageService: FirebaseMessageService,
    private firebaseAdminService: FirebaseAdminService,
  ) {}

  async createPaymentIntent(
    reservationId: string,
    customerInfo?: DialogGenieCustomerDto,
  ) {
    this.logger.log(`🔄 createPaymentIntent called for reservation ${reservationId}`);
    this.logger.log(`   Customer Info received: ${customerInfo ? JSON.stringify(customerInfo) : 'NONE'}`);
    
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new BadRequestException('Reservation not found');
    }
    
    // Log current state (customer info will be saved below if provided)
    this.logger.log(`   Seat Lock found. Customer info before save: Name=${seatLock.customerName || 'NOT SET'}, Email=${seatLock.customerEmail || 'NOT SET'}, Phone=${seatLock.phoneNumber || 'NOT SET'}`);

    if (seatLock.status !== 'pending_payment') {
      throw new BadRequestException('Reservation is not in pending payment state');
    }

    if (!seatLock.amountSummary) {
      throw new BadRequestException('Reservation amount not calculated');
    }

    // SANDBOX/TESTING: Using dummy amount instead of actual amount
    // TODO: Uncomment actual amount calculation when moving to production
    // const totalAmount = seatLock.amountSummary.total;
    // const amountInCents = Math.round(totalAmount * 100);
    
    // Dummy amount for sandbox testing (1.00 LKR = 100 cents)
    const totalAmount = 1.00;
    const amountInCents = 100;

    // Set seats to payment_pending state BEFORE redirecting to Dialog Genie
    try {
      await this.seatsService.setSeatsToPaymentPending(seatLock.seatIds, reservationId);
      this.logger.log(`Set ${seatLock.seatIds.length} seat(s) to payment_pending for reservation ${reservationId}`);
    } catch (error) {
      this.logger.error(`Failed to set seats to payment_pending: ${error}`);
      throw new BadRequestException('Failed to update seat states');
    }

    // Set booking paymentState to pending
    await this.bookingModel.updateMany(
      { reservationId },
      { paymentState: PaymentState.PENDING },
    ).exec();

    // Get Dialog Genie API configuration from environment
    const dialogGenieApiUrl = 
      this.configService.get<string>('DIALOG_GENIE_API_URL') || 
      process.env.DIALOG_GENIE_API_URL;
    
    const dialogGenieApiKey = 
      this.configService.get<string>('DIALOG_GENIE_API_KEY') || 
      process.env.DIALOG_GENIE_API_KEY;

    if (!dialogGenieApiUrl) {
      throw new BadRequestException('Dialog Genie API URL is not configured');
    }

    if (!dialogGenieApiKey) {
      throw new BadRequestException(
        'Dialog Genie API key is not configured. Please check DIALOG_GENIE_API_KEY in server.env'
      );
    }

    const trimmedApiKey = dialogGenieApiKey.trim();
    if (trimmedApiKey === '' || trimmedApiKey === 'your_api_key_here') {
      throw new BadRequestException(
        'Dialog Genie API key is invalid. Please set a valid API key in server.env'
      );
    }

    // Get ngrok URL for callback
    const ngrokUrl = 
      this.configService.get<string>('NGROK_URL') || 
      process.env.NGROK_URL;

    // Prepare Dialog Genie payment payload
    // CRITICAL: localId is the reservationId that will be returned in the callback
    const dialogGeniePayload: any = {
      amount: amountInCents,
      localId: reservationId, // This is the reservationId that Dialog Genie will return in the callback
      currency: 'LKR',
    };
    
    this.logger.log(`📤 Dialog Genie payload prepared:`);
    this.logger.log(`   amount: ${amountInCents} cents (${totalAmount} LKR)`);
    this.logger.log(`   localId: ${reservationId} (CRITICAL - this will be returned in callback)`);
    this.logger.log(`   currency: LKR`);

    // Add redirect URL to redirect to summary page after payment
    // Use the redirect handler endpoint which will process payment and redirect to frontend
    if (ngrokUrl) {
      const redirectUrl = `${ngrokUrl.replace(/\/$/, '')}/api/payments/redirect`;
      dialogGeniePayload.redirectUrl = redirectUrl;
      this.logger.log(`Setting Dialog Genie redirect URL: ${redirectUrl}`);
    } else {
      this.logger.warn('NGROK_URL not configured. Redirect URL will not be set in Dialog Genie payload.');
    }

    // Get phone number from authenticated user's profile first (not from form)
    // Priority: 1. User profile (Firestore), 2. SeatLock (if already set), 3. customerInfo (fallback)
    let userPhoneNumber: string | null = null;
    if (seatLock.buyerId) {
      try {
        userPhoneNumber = await this.getUserPhoneNumberFromProfile(seatLock.buyerId);
        if (userPhoneNumber) {
          this.logger.log(`📱 Phone number retrieved from user profile: ${userPhoneNumber}`);
        } else {
          this.logger.warn(`⚠️  Phone number not found in user profile for buyerId: ${seatLock.buyerId}`);
        }
      } catch (error: any) {
        this.logger.warn(`⚠️  Could not retrieve phone from user profile: ${error.message}`);
      }
    }
    
    // Add customer information
    if (customerInfo) {
      // Save all customer information to seat lock for booking records
      // Use phone number from user profile if available, otherwise use customerInfo
      seatLock.phoneNumber = userPhoneNumber || customerInfo.phoneNumber || seatLock.phoneNumber;
      seatLock.customerName = customerInfo.name;
      seatLock.customerEmail = customerInfo.email;
      seatLock.billingEmail = customerInfo.billingEmail || customerInfo.email;
      seatLock.billingAddress1 = customerInfo.billingAddress1 || '';
      seatLock.billingCity = customerInfo.billingCity || '';
      seatLock.billingCountry = customerInfo.billingCountry || 'Sri Lanka';
      seatLock.billingPostCode = customerInfo.billingPostCode || '';
      
      this.logger.log(`💾 Saving customer information to seat lock ${reservationId}:`);
      this.logger.log(`   Phone: ${seatLock.phoneNumber} (source: ${userPhoneNumber ? 'user profile' : customerInfo.phoneNumber ? 'customerInfo' : 'existing'})`);
      this.logger.log(`   Name: ${seatLock.customerName}`);
      this.logger.log(`   Email: ${seatLock.customerEmail}`);
      this.logger.log(`   Phone: ${seatLock.phoneNumber}`);
      this.logger.log(`   Billing Email: ${seatLock.billingEmail}`);
      this.logger.log(`   Billing Address: ${seatLock.billingAddress1}, ${seatLock.billingCity}, ${seatLock.billingCountry} ${seatLock.billingPostCode}`);
      
      await seatLock.save();
      
      // Verify the save worked
      const verifySeatLock = await this.seatLockModel.findById(reservationId).exec();
      if (verifySeatLock) {
        this.logger.log(`✅ Verified customer info saved: Name=${verifySeatLock.customerName || 'NOT SET'}, Email=${verifySeatLock.customerEmail || 'NOT SET'}, Phone=${verifySeatLock.phoneNumber || 'NOT SET'}`);
      } else {
        this.logger.error(`❌ Failed to verify seat lock after save!`);
      }

      dialogGeniePayload.customer = {
        name: customerInfo.name,
        email: customerInfo.email,
        billingEmail: customerInfo.billingEmail || customerInfo.email,
        billingAddress1: customerInfo.billingAddress1 || '',
        billingCity: customerInfo.billingCity || '',
        billingCountry: customerInfo.billingCountry || 'Sri Lanka',
        billingPostCode: customerInfo.billingPostCode || '',
      };
    } else {
      const defaultEmail = seatLock.phoneNumber 
        ? `${seatLock.phoneNumber}@booking.local` 
        : 'customer@booking.local';
      
      dialogGeniePayload.customer = {
        name: 'Customer',
        email: defaultEmail,
        billingEmail: defaultEmail,
        billingAddress1: 'Not provided',
        billingCity: 'Colombo',
        billingCountry: 'Sri Lanka',
        billingPostCode: '00000',
      };
    }

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': trimmedApiKey,
    };

    // Make API request to Dialog Genie
    let paymentUrl: string;
    let dialogGenieTransactionId: string;
    const paymentId = `dialog_pi_${reservationId}_${Date.now()}`;

    try {
      const response = await axios.post(dialogGenieApiUrl, dialogGeniePayload, {
        headers,
        timeout: 30000,
      });

      const responseData = response.data || {};
      
      paymentUrl = responseData.url || responseData.shortUrl || null;
      dialogGenieTransactionId = responseData.id || paymentId;

      if (!paymentUrl) {
        this.logger.error(`Dialog Genie API response missing payment URL`);
        throw new BadRequestException(
          'Dialog Genie API did not return a payment URL in the response'
        );
      }

      // Validate payment URL format
      try {
        new URL(paymentUrl);
      } catch (e) {
        throw new BadRequestException('Dialog Genie API returned an invalid payment URL format');
      }

      this.logger.log(
        `Dialog Genie transaction created successfully. Transaction ID: ${dialogGenieTransactionId}`
      );
    } catch (error: any) {
      this.logger.error(`Failed to create Dialog Genie transaction: ${error.message}`);
      
      if (error.response) {
        // Log full error response for debugging
        this.logger.error(`Dialog Genie API Error Response: ${JSON.stringify({
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers,
        }, null, 2)}`);
        
        const errorMessage = error.response.data?.message || 
                            error.response.data?.error || 
                            error.response.statusText || 
                            error.message;
        
        if (error.response.status === 403) {
          throw new BadRequestException(
            `Dialog Genie API returned 403 Forbidden. Please verify your API key is valid and has the required permissions. Error: ${errorMessage}`
          );
        }
        
        throw new BadRequestException(
          `Dialog Genie API error: ${errorMessage || 'Unknown error'}`
        );
      }

      throw new BadRequestException(
        `Failed to connect to Dialog Genie API: ${error.message}`
      );
    }

    // Update seat lock: change state to -2 (IN_PAYMENT_GATEWAY) and save payment intent ID
    // This protects the booking from expiry while user is at payment gateway
    seatLock.numericState = ReservationNumericState.IN_PAYMENT_GATEWAY; // -2
    seatLock.paymentIntentId = dialogGenieTransactionId;
    await seatLock.save();

    // Backup to backup database for -2 state bookings
    try {
      const backupData = {
        _id: seatLock._id,
        eventId: seatLock.eventId,
        buyerId: seatLock.buyerId,
        sessionId: seatLock.sessionId,
        seatIds: seatLock.seatIds,
        numericState: ReservationNumericState.IN_PAYMENT_GATEWAY,
        expiresAt: seatLock.expiresAt,
        amountSummary: seatLock.amountSummary,
        paymentIntentId: dialogGenieTransactionId,
        phoneNumber: seatLock.phoneNumber,
        customerName: seatLock.customerName,
        customerEmail: seatLock.customerEmail,
        billingEmail: seatLock.billingEmail,
        billingAddress1: seatLock.billingAddress1,
        billingCity: seatLock.billingCity,
        billingCountry: seatLock.billingCountry,
        billingPostCode: seatLock.billingPostCode,
        backedUpAt: new Date(),
      };

      await this.seatLockBackupModel.create(backupData);
      this.logger.log(`Backed up reservation ${reservationId} to backup database (state -2)`);
    } catch (error: any) {
      this.logger.error(`Failed to backup reservation ${reservationId}: ${error.message}`);
      // Don't fail the payment flow if backup fails, just log the error
    }

    // STEP: Create Firestore document with SUCCESS status (payment will be processed)
    // Note: We save as SUCCESS initially since payment will be processed immediately
    // If payment fails, status will be updated to FAILED in the callback handler
    this.logger.log(``);
    this.logger.log(`📱 ========== CREATING FIRESTORE DOCUMENT BEFORE PAYMENT ==========`);
    this.logger.log(`   Reservation ID: ${reservationId}`);
    this.logger.log(`   Payment Intent ID: ${dialogGenieTransactionId}`);
    this.logger.log(`   Status: SUCCESS (will be updated to FAILED if payment fails)`);
    
    try {
      const firestore = this.firebaseAdminService.getFirestore();
      if (firestore && this.firebaseAdminService.isInitialized()) {
        // Get event details for the document
        const event = await this.eventsService.findOne(seatLock.eventId.toString());
        const eventName = event?.title || 'Unknown Event';
        const venue = event?.venue?.name || 'TBA';
        
        // Get seat labels
        const seats = await Promise.all(
          seatLock.seatIds.map(seatId => this.seatsService.findOne(seatId))
        );
        const seatLabels = seats.map(seat => seat.label || `Seat ${seat._id}`);
        
        // Create Firestore document with SUCCESS status
        const bookingDocument = {
          reservationId: reservationId,
          paymentIntentId: dialogGenieTransactionId,
          status: 'SUCCESS', // Changed from PENDING_PAYMENT to SUCCESS
          phone: seatLock.phoneNumber || '',
          customerName: seatLock.customerName || '',
          customerEmail: seatLock.customerEmail || '',
          eventId: seatLock.eventId.toString(),
          eventName: eventName,
          venue: venue,
          seats: seatLabels,
          amount: totalAmount,
          currency: 'LKR',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        this.logger.log(`   Creating document in Firestore bookings collection...`);
        this.logger.log(`   Document data: ${JSON.stringify(bookingDocument, null, 2)}`);
        
        const docRef = await firestore
          .collection('bookings')
          .doc(reservationId)
          .set(bookingDocument);
        
        this.logger.log(`✅ Successfully created Firestore document with SUCCESS status`);
        this.logger.log(`   Collection: bookings`);
        this.logger.log(`   Document ID: ${reservationId}`);
        this.logger.log(`   Status: SUCCESS`);
        this.logger.log(`   Note: Status will be updated to FAILED if payment callback indicates failure`);
        
        // Send SMS immediately after saving Firestore document
        // This is a backup - SMS will also be sent in confirmBooking() when payment callback is received
        // But sending it here ensures SMS is sent even if payment callback is delayed or not triggered
        if (seatLock.phoneNumber) {
          try {
            this.logger.log(``);
            this.logger.log(`📱 ========== SENDING SMS IMMEDIATELY AFTER FIRESTORE SAVE ==========`);
            this.logger.log(`   Phone: ${seatLock.phoneNumber}`);
            this.logger.log(`   Event: ${eventName}`);
            this.logger.log(`   Venue: ${venue}`);
            this.logger.log(`   Seats: ${seatLabels.join(', ')}`);
            this.logger.log(`   Note: This is sent immediately. SMS will also be sent again in payment callback.`);
            
            // Get event date
            const eventDate = event?.startAt || new Date();
            
            // Send SMS via bookings service
            const smsResult = await this.bookingsService.sendSmsForReservation(
              reservationId,
              seatLock.phoneNumber,
              eventName,
              seatLabels,
              eventDate,
              venue,
            );
            
            if (smsResult) {
              this.logger.log(`✅ SMS sent successfully immediately after Firestore save`);
            } else {
              this.logger.warn(`⚠️  SMS sending failed immediately, will retry in payment callback`);
            }
          } catch (smsError: any) {
            // Don't fail the payment flow if SMS fails
            this.logger.error(`❌ Failed to send SMS immediately: ${smsError.message}`);
            this.logger.error(`   Payment flow will continue, SMS will be retried in payment callback`);
          }
        } else {
          this.logger.warn(`⚠️  Phone number not available in seatLock, skipping immediate SMS send`);
          this.logger.warn(`   Phone: ${seatLock.phoneNumber || 'NOT SET'}`);
          this.logger.warn(`   SMS will be sent in payment callback when phone number is available`);
        }
      } else {
        this.logger.warn(`⚠️  Firestore not available - skipping pre-payment document creation`);
        this.logger.warn(`   Firebase initialized: ${this.firebaseAdminService.isInitialized()}`);
        this.logger.warn(`   Firestore instance: ${firestore ? 'Available' : 'NULL'}`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Failed to create Firestore document before payment: ${error.message}`);
      this.logger.error(`   Error stack: ${error.stack}`);
      this.logger.error(`   This is a warning - payment flow will continue, but Firestore document was not created`);
      // Don't fail the payment flow if Firestore save fails
    }

    return {
      paymentIntentId: dialogGenieTransactionId,
      paymentUrl,
      amount: totalAmount,
    };
  }

  async processDummyPayment(reservationId: string, paymentData: {
    cardNumber: string;
    expiryDate: string;
    cvv: string;
    phoneNumber: string;
  }) {
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new BadRequestException('Reservation not found');
    }

    if (seatLock.status !== 'pending_payment') {
      throw new BadRequestException(`Reservation is not in pending payment state. Current status: ${seatLock.status}`);
    }

    // Validate card number
    if (!paymentData.cardNumber) {
      throw new BadRequestException('Card number is required');
    }
    
    const cardNumber = paymentData.cardNumber.replace(/\s/g, '');
    if (!/^[345]\d{15}$/.test(cardNumber)) {
      throw new BadRequestException('Invalid card number. Use a dummy card starting with 3, 4, or 5 (16 digits)');
    }

    // Validate expiry date
    if (!paymentData.expiryDate) {
      throw new BadRequestException('Expiry date is required');
    }

    const expiryParts = paymentData.expiryDate.split('/');
    if (expiryParts.length !== 2) {
      throw new BadRequestException('Invalid expiry date format. Use MM/YY format (e.g., 12/25)');
    }

    const [month, year] = expiryParts;
    const expiryMonth = parseInt(month, 10);
    const expiryYear = parseInt(year, 10);
    
    if (isNaN(expiryMonth) || isNaN(expiryYear) || expiryMonth < 1 || expiryMonth > 12) {
      throw new BadRequestException('Invalid expiry date. Use MM/YY format (e.g., 12/25)');
    }

    const fullYear = 2000 + expiryYear;
    const now = new Date();
    const expiryDate = new Date(fullYear, expiryMonth - 1);
    
    if (expiryDate < now) {
      throw new BadRequestException('Card has expired. Use a future date (e.g., 12/25)');
    }

    // Validate CVV
    if (!paymentData.cvv || !/^\d{3,4}$/.test(paymentData.cvv)) {
      throw new BadRequestException('Invalid CVV. Use 3 or 4 digits');
    }

    // Process payment (dummy - always succeeds)
    const paymentIntentId = `dummy_pi_${reservationId}_${Date.now()}`;
    const confirmation = await this.bookingsService.confirmBooking(reservationId, paymentIntentId);

    return {
      success: true,
      paymentIntentId,
      reservationId,
      confirmation,
    };
  }

  async handleDialogGenieCallback(callbackData: {
    paymentId: string;
    status: 'SUCCESS' | 'FAILED';
  }) {
    this.logger.log(`📞 Received Dialog Genie callback: ${JSON.stringify(callbackData)}`);

    // Try to find seat lock by payment intent ID
    let seatLock = await this.seatLockModel.findOne({
      paymentIntentId: callbackData.paymentId,
    }).exec();

    // If not found, try to find by any payment-related field
    if (!seatLock) {
      this.logger.warn(`Seat lock not found by paymentIntentId: ${callbackData.paymentId}. Trying alternative search...`);
      // Try searching in backup collection
      const backupLock = await this.seatLockBackupModel.findOne({
        paymentIntentId: callbackData.paymentId,
      }).exec();
      
      if (backupLock) {
        // Find the original seat lock by ID
        seatLock = await this.seatLockModel.findById(backupLock._id).exec();
        if (seatLock) {
          this.logger.log(`Found seat lock via backup collection: ${backupLock._id}`);
        }
      }
    }

    if (!seatLock) {
      this.logger.error(`❌ Seat lock not found for payment ID: ${callbackData.paymentId}`);
      this.logger.error(`   Searched in: seatLockModel by paymentIntentId, seatLockBackupModel`);
      throw new NotFoundException(`Reservation not found for payment ID: ${callbackData.paymentId}`);
    }
    
    this.logger.log(`✅ Found seat lock: ${seatLock._id.toString()}, Status: ${seatLock.status}, NumericState: ${seatLock.numericState}`);
    this.logger.log(`   Customer Info Check: Name=${seatLock.customerName || 'NOT SET'}, Email=${seatLock.customerEmail || 'NOT SET'}, Phone=${seatLock.phoneNumber || 'NOT SET'}`);

    if (callbackData.status === 'SUCCESS') {
      this.logger.log(`💰 ========== PAYMENT SUCCESSFUL ==========`);
      this.logger.log(`   Reservation ID: ${seatLock._id.toString()}`);
      this.logger.log(`   Payment ID: ${callbackData.paymentId}`);

      // STEP 1: Update Firestore document (status is already SUCCESS, just update paymentIntentId and timestamp)
      this.logger.log(``);
      this.logger.log(`📱 ========== UPDATING FIRESTORE DOCUMENT ==========`);
      this.logger.log(`   Reservation ID: ${seatLock._id.toString()}`);
      this.logger.log(`   Payment ID: ${callbackData.paymentId}`);
      this.logger.log(`   Note: Status is already SUCCESS from initial save, updating paymentIntentId and timestamp`);
      
      try {
        const firestore = this.firebaseAdminService.getFirestore();
        if (firestore && this.firebaseAdminService.isInitialized()) {
          await firestore
            .collection('bookings')
            .doc(seatLock._id.toString())
            .update({
              status: 'SUCCESS', // Keep as SUCCESS (was already set during createPaymentIntent)
              paymentIntentId: callbackData.paymentId,
              updatedAt: new Date(),
            });
          
          this.logger.log(`✅ Successfully updated Firestore document`);
          this.logger.log(`   Collection: bookings`);
          this.logger.log(`   Document ID: ${seatLock._id.toString()}`);
          this.logger.log(`   Status: SUCCESS (confirmed)`);
          this.logger.log(`   Payment Intent ID: ${callbackData.paymentId}`);
        } else {
          this.logger.warn(`⚠️  Firestore not available - skipping status update`);
          this.logger.warn(`   Firebase initialized: ${this.firebaseAdminService.isInitialized()}`);
          this.logger.warn(`   Firestore instance: ${firestore ? 'Available' : 'NULL'}`);
        }
      } catch (error: any) {
        this.logger.error(`❌ Failed to update Firestore document: ${error.message}`);
        this.logger.error(`   Error stack: ${error.stack}`);
        this.logger.error(`   This is a warning - payment flow will continue, but Firestore document was not updated`);
        // Don't fail the payment flow if Firestore update fails
      }

      // STEP 2: Reload seat lock from MongoDB to ensure we have the latest customer info
      this.logger.log(`📖 Reloading seat lock from MongoDB to get latest customer information...`);
      const freshSeatLock = await this.seatLockModel.findById(seatLock._id.toString()).exec();
      if (freshSeatLock) {
        seatLock = freshSeatLock;
        this.logger.log(`✅ Reloaded from MongoDB SeatLock. Customer Info:`);
        this.logger.log(`   Name: ${seatLock.customerName || 'NOT SET'}`);
        this.logger.log(`   Email: ${seatLock.customerEmail || 'NOT SET'}`);
        this.logger.log(`   Phone: ${seatLock.phoneNumber || 'NOT SET'}`);
        this.logger.log(`   Billing Email: ${seatLock.billingEmail || 'NOT SET'}`);
      } else {
        this.logger.error(`❌ Failed to reload seat lock from MongoDB!`);
        throw new Error(`Failed to reload seat lock from MongoDB for reservation ${seatLock._id.toString()}`);
      }

      // STEP 3: Update seat lock numericState to 1 (PAYMENT_SUCCESS) and save to MongoDB
      seatLock.numericState = ReservationNumericState.PAYMENT_SUCCESS; // 1
      await seatLock.save();
      this.logger.log(`✅ Updated seat lock in MongoDB: numericState = PAYMENT_SUCCESS`);

      // STEP 4: Confirm the booking - this will:
      //   - Read customer info from MongoDB SeatLock
      //   - Create booking records in MongoDB
      //   - Save SMS message to Firebase Firestore using data from MongoDB SeatLock
      this.logger.log(``);
      this.logger.log(`🔄 ========== CONFIRMING BOOKING ==========`);
      this.logger.log(`   Flow: MongoDB SeatLock → Read customer data → Create bookings → Save to Firestore`);
      this.logger.log(`   Payment ID: ${callbackData.paymentId}`);
      this.logger.log(`   Seat Lock Status: ${seatLock.status}`);
      this.logger.log(`   Numeric State: ${seatLock.numericState}`);
      this.logger.log(`   Customer data in MongoDB SeatLock:`);
      this.logger.log(`     Phone Number: ${seatLock.phoneNumber || 'NOT SET'}`);
      this.logger.log(`     Customer Name: ${seatLock.customerName || 'NOT SET'}`);
      this.logger.log(`     Customer Email: ${seatLock.customerEmail || 'NOT SET'}`);
      this.logger.log(`   Number of Seats: ${seatLock.seatIds.length}`);
      this.logger.log(`   Seat IDs: ${seatLock.seatIds.join(', ')}`);
      
      let confirmation;
      try {
        confirmation = await this.bookingsService.confirmBooking(
          seatLock._id.toString(),
          callbackData.paymentId,
        );
        
        this.logger.log(`✅ ========== BOOKING CONFIRMED SUCCESSFULLY ==========`);
        this.logger.log(`   Reservation ID: ${confirmation.reservationId}`);
        this.logger.log(`   Booking IDs: ${confirmation.bookings.map((id: any) => id.toString()).join(', ')}`);
        this.logger.log(`   Confirmed Seats: ${confirmation.confirmedSeats.join(', ')}`);
        this.logger.log(`✅ Complete flow executed:`);
        this.logger.log(`   1. ✅ Customer info saved to MongoDB SeatLock (during payment intent)`);
        this.logger.log(`   2. ✅ Payment successful - customer info in MongoDB SeatLock`);
        this.logger.log(`   3. ✅ Read customer info from MongoDB SeatLock`);
        this.logger.log(`   4. ✅ Created bookings in MongoDB`);
        this.logger.log(`   5. ✅ Saved SMS message to Firebase Firestore (using data from MongoDB SeatLock)`);

        // Update booking paymentState to success after confirmation
        const updateResult = await this.bookingModel.updateMany(
          { reservationId: seatLock._id.toString() },
          {
            paymentState: PaymentState.SUCCESS,
            dialogPaymentId: callbackData.paymentId,
          },
        ).exec();
        
        this.logger.log(`✅ Updated ${updateResult.modifiedCount} booking(s) payment state to SUCCESS`);
        
        // Verify bookings were created
        const createdBookings = await this.bookingModel.find({ reservationId: seatLock._id.toString() }).exec();
        this.logger.log(`📊 Verification: Found ${createdBookings.length} booking(s) in MongoDB for reservation ${seatLock._id.toString()}`);

      } catch (error: any) {
        this.logger.error(`❌ ========== FAILED TO CONFIRM BOOKING ==========`);
        this.logger.error(`   Error: ${error.message}`);
        this.logger.error(`   Stack: ${error.stack}`);
        this.logger.error(`   Error name: ${error.name}`);
        this.logger.error(`   Error code: ${error.code}`);
        this.logger.error(`   Reservation ID: ${seatLock._id.toString()}`);
        this.logger.error(`   Payment ID: ${callbackData.paymentId}`);
        this.logger.error(`   Seat Lock Status: ${seatLock.status}`);
        this.logger.error(`   Seat Lock Numeric State: ${seatLock.numericState}`);
        
        // Check if any bookings were created despite the error
        const existingBookings = await this.bookingModel.find({ reservationId: seatLock._id.toString() }).exec();
        if (existingBookings.length > 0) {
          this.logger.warn(`⚠️  Found ${existingBookings.length} booking(s) that were created before the error occurred`);
          // Try to save to Firebase even if there was an error
          this.logger.log(`🔄 Attempting to save existing bookings to Firebase...`);
          try {
            await this.bookingsService.confirmBooking(seatLock._id.toString(), callbackData.paymentId);
            this.logger.log(`✅ Successfully saved existing bookings to Firebase`);
          } catch (firebaseError: any) {
            this.logger.error(`❌ Failed to save to Firebase: ${firebaseError.message}`);
          }
        } else {
          this.logger.error(`❌ No bookings were created in MongoDB for reservation ${seatLock._id.toString()}`);
        }
        
        // Still update payment state even if confirmation fails
        await this.bookingModel.updateMany(
          { reservationId: seatLock._id.toString() },
          {
            paymentState: PaymentState.SUCCESS,
            dialogPaymentId: callbackData.paymentId,
          },
        ).exec();
        
        // Re-throw the error so the redirect handler can handle it
        throw error;
      }

      return {
        success: true,
        reservationId: seatLock._id.toString(),
        message: 'Payment successful and booking confirmed',
        confirmation,
      };
    } else {
      this.logger.log(`❌ ========== PAYMENT FAILED ==========`);
      this.logger.log(`   Reservation ID: ${seatLock._id.toString()}`);
      this.logger.log(`   Payment ID: ${callbackData.paymentId}`);
      
      // STEP 1: Update Firestore document status to FAILED
      this.logger.log(``);
      this.logger.log(`📱 ========== UPDATING FIRESTORE STATUS TO FAILED ==========`);
      this.logger.log(`   Reservation ID: ${seatLock._id.toString()}`);
      this.logger.log(`   Payment ID: ${callbackData.paymentId}`);
      
      try {
        const firestore = this.firebaseAdminService.getFirestore();
        if (firestore && this.firebaseAdminService.isInitialized()) {
          await firestore
            .collection('bookings')
            .doc(seatLock._id.toString())
            .update({
              status: 'FAILED',
              paymentIntentId: callbackData.paymentId,
              updatedAt: new Date(),
            });
          
          this.logger.log(`✅ Successfully updated Firestore document status to FAILED`);
          this.logger.log(`   Collection: bookings`);
          this.logger.log(`   Document ID: ${seatLock._id.toString()}`);
          this.logger.log(`   Status: FAILED`);
        } else {
          this.logger.warn(`⚠️  Firestore not available - skipping status update`);
        }
      } catch (error: any) {
        this.logger.error(`❌ Failed to update Firestore status to FAILED: ${error.message}`);
        this.logger.error(`   Error stack: ${error.stack}`);
        // Don't fail the payment flow if Firestore update fails
      }
      
      // Update booking paymentState to failed in MongoDB
      await this.bookingModel.updateMany(
        { reservationId: seatLock._id.toString() },
        {
          paymentState: PaymentState.FAILED,
          dialogPaymentId: callbackData.paymentId,
        },
      ).exec();

      return {
        success: false,
        reservationId: seatLock._id.toString(),
        message: 'Payment failed',
      };
    }
  }

  async handleDialogGenieRedirect(query: any, res: Response) {
    this.logger.log(``);
    this.logger.log(`🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥 testing Firebase save`);
    this.logger.log(`🔄 ========== DIALOG GENIE REDIRECT RECEIVED ==========`);
    this.logger.log(`📥 Query parameters received: ${JSON.stringify(query, null, 2)}`);
    this.logger.log(`   Raw query: ${JSON.stringify(query)}`);

    // Extract payment information from query parameters
    // Dialog Genie might send: id, transactionId, paymentId, transactionReference, status, localId, etc.
    // CRITICAL: localId is the reservationId we sent in the payload - Dialog Genie returns it in the callback
    const paymentId = query.id || query.transactionId || query.paymentId || query.transactionReference;
    const status = query.status || 
                   (query.success === 'true' || query.success === true ? 'SUCCESS' : 
                   (query.success === 'false' || query.success === false ? 'FAILED' : 'SUCCESS'));
    const localId = query.localId || query.reservationId;

    this.logger.log(`🔍 Extracted payment info from Dialog Genie callback:`);
    this.logger.log(`   Payment ID: ${paymentId || 'NOT FOUND'}`);
    this.logger.log(`   Status: ${status}`);
    this.logger.log(`   Local ID (reservationId from Dialog Genie): ${localId || 'NOT FOUND'}`);
    this.logger.log(`   ⚠️  If localId is NOT FOUND, we cannot find the reservation!`);
    this.logger.log(`   Full query params: ${JSON.stringify(query, null, 2)}`);

    // If we have a localId (reservationId), use it to find the reservation
    let seatLock: SeatLockDocument | null = null;
    
    if (localId) {
      this.logger.log(`🔍 Searching for seat lock by reservationId: ${localId}`);
      const foundLock = await this.seatLockModel.findById(localId).exec();
      if (foundLock) {
        seatLock = foundLock;
        this.logger.log(`✅ Found seat lock by reservationId`);
        if (paymentId && !seatLock.paymentIntentId) {
          // Update payment intent ID if it wasn't set
          seatLock.paymentIntentId = paymentId;
          await seatLock.save();
          this.logger.log(`Updated payment intent ID for reservation ${localId}: ${paymentId}`);
        }
      } else {
        this.logger.warn(`⚠️  Seat lock not found by reservationId: ${localId}`);
      }
    }

    // If not found by localId, try to find by payment intent ID
    if (!seatLock && paymentId) {
      this.logger.log(`🔍 Searching for seat lock by paymentIntentId: ${paymentId}`);
      const foundLock = await this.seatLockModel.findOne({
        paymentIntentId: paymentId,
      }).exec();
      if (foundLock) {
        seatLock = foundLock;
        this.logger.log(`✅ Found seat lock by paymentIntentId`);
      } else {
        this.logger.warn(`⚠️  Seat lock not found by paymentIntentId: ${paymentId}`);
      }
    }

    if (!seatLock) {
      this.logger.error(`❌ Seat lock not found. Payment ID: ${paymentId}, Local ID: ${localId}`);
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || process.env.FRONTEND_URL || 'http://localhost:3001';
      return res.redirect(`${frontendUrl}/bookings/error?message=${encodeURIComponent('Reservation not found. Please contact support.')}`);
    }

    this.logger.log(`✅ Seat lock found: ${seatLock._id.toString()}`);
    this.logger.log(`   Phone Number: ${seatLock.phoneNumber || 'NOT SET'}`);
    this.logger.log(`   Customer Name: ${seatLock.customerName || 'NOT SET'}`);
    this.logger.log(`   Customer Email: ${seatLock.customerEmail || 'NOT SET'}`);

    try {
      // Process the callback
      const finalPaymentId = paymentId || seatLock.paymentIntentId || '';
      this.logger.log(`🔄 Calling handleDialogGenieCallback with paymentId: ${finalPaymentId}, status: ${status}`);
      const result = await this.handleDialogGenieCallback({ 
        paymentId: finalPaymentId, 
        status: status as 'SUCCESS' | 'FAILED' 
      });
      
      this.logger.log(`✅ Callback processed. Result: ${JSON.stringify(result)}`);

      // Redirect to frontend success page - always use FRONTEND_URL, not ngrok
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || process.env.FRONTEND_URL || 'http://localhost:3001';
      const reservationId = seatLock._id.toString();

      if (result.success) {
        this.logger.log(`Redirecting to success page for reservation ${reservationId}`);
        return res.redirect(`${frontendUrl}/bookings/${reservationId}/success`);
      } else {
        this.logger.log(`Payment failed, redirecting to booking page for reservation ${reservationId}`);
        return res.redirect(`${frontendUrl}/bookings/${reservationId}?payment=failed`);
      }
    } catch (error: any) {
      this.logger.error(`Error handling Dialog Genie redirect: ${error.message}`, error.stack);
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || process.env.FRONTEND_URL || 'http://localhost:3001';
      return res.redirect(`${frontendUrl}/bookings/error?message=${encodeURIComponent(error.message || 'An error occurred processing your payment')}`);
    }
  }

  async handleWebhook(payload: any, signature: string) {
    // Placeholder for future Stripe webhook integration
    return { processed: true };
  }

  /**
   * Check Dialog Genie transaction status and manually confirm booking for testing
   * This bypasses the redirect flow and directly checks payment status
   */
  async triggerSmsForReservation(reservationId: string): Promise<any> {
    this.logger.log(`📱 ========== MANUALLY TRIGGERING SMS ==========`);
    this.logger.log(`   Reservation ID: ${reservationId}`);

    // Find seat lock
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    this.logger.log(`✅ Seat lock found:`);
    this.logger.log(`   Phone Number: ${seatLock.phoneNumber || 'NOT SET'}`);
    this.logger.log(`   Customer Name: ${seatLock.customerName || 'NOT SET'}`);
    this.logger.log(`   Status: ${seatLock.status}`);

    if (!seatLock.phoneNumber) {
      throw new BadRequestException('Phone number is not set for this reservation');
    }

    // Get event details
    const event = await this.eventsService.findOne(seatLock.eventId.toString());
    if (!event) {
      throw new NotFoundException(`Event not found for reservation ${reservationId}`);
    }

    // Get seat labels
    const seats = await Promise.all(
      seatLock.seatIds.map(seatId => this.seatsService.findOne(seatId))
    );
    const seatLabels = seats.map(seat => seat.label || `Seat ${seat._id}`);

    // Get event date
    const eventDate = event.startAt || new Date();

    // Update Firestore status to SUCCESS (for testing)
    try {
      const firestore = this.firebaseAdminService.getFirestore();
      if (firestore && this.firebaseAdminService.isInitialized()) {
        this.logger.log(`📱 Updating Firestore status to SUCCESS...`);
        await firestore
          .collection('bookings')
          .doc(reservationId)
          .update({
            status: 'SUCCESS',
            updatedAt: new Date(),
          });
        this.logger.log(`✅ Firestore status updated to SUCCESS`);
      } else {
        this.logger.warn(`⚠️  Firestore not available, skipping status update`);
      }
    } catch (firestoreError: any) {
      this.logger.warn(`⚠️  Failed to update Firestore status: ${firestoreError.message}`);
      // Continue with SMS even if Firestore update fails
    }

    // Trigger SMS via bookings service
    try {
      this.logger.log(`📱 Triggering SMS via BookingsService...`);
      const result = await this.bookingsService.sendSmsForReservation(
        reservationId,
        seatLock.phoneNumber,
        event.title,
        seatLabels,
        eventDate,
        event.venue?.name || 'TBA',
      );

      return {
        success: true,
        reservationId,
        phone: seatLock.phoneNumber,
        message: 'SMS triggered successfully and Firestore status updated to SUCCESS',
        smsResult: result,
        firestoreUpdated: true,
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to trigger SMS: ${error.message}`);
      throw new BadRequestException(`Failed to trigger SMS: ${error.message}`);
    }
  }

  async findReservationByPaymentId(paymentId: string): Promise<any> {
    this.logger.log(`🔍 Finding reservation by payment ID: ${paymentId}`);
    
    // Try to find by payment intent ID
    const seatLock = await this.seatLockModel.findOne({
      paymentIntentId: paymentId,
    }).exec();

    if (!seatLock) {
      // Try backup collection
      const backupLock = await this.seatLockBackupModel.findOne({
        paymentIntentId: paymentId,
      }).exec();
      
      if (backupLock) {
        const originalLock = await this.seatLockModel.findById(backupLock._id).exec();
        if (originalLock) {
          return {
            found: true,
            reservationId: originalLock._id.toString(),
            paymentId,
            status: originalLock.status,
            phoneNumber: originalLock.phoneNumber,
            customerName: originalLock.customerName,
          };
        }
      }
      
      throw new NotFoundException(`Reservation with payment ID ${paymentId} not found`);
    }

    return {
      found: true,
      reservationId: seatLock._id.toString(),
      paymentId,
      status: seatLock.status,
      phoneNumber: seatLock.phoneNumber,
      customerName: seatLock.customerName,
    };
  }

  async checkAndConfirmBooking(reservationId: string, paymentId?: string): Promise<any> {
    this.logger.log(`🔍 ========== CHECKING AND CONFIRMING BOOKING ==========`);
    this.logger.log(`   Reservation ID: ${reservationId}`);
    this.logger.log(`   Payment ID: ${paymentId || 'NOT PROVIDED'}`);

    // Find seat lock - try multiple methods
    let seatLock = await this.seatLockModel.findById(reservationId).exec();
    
    if (!seatLock && paymentId) {
      // Try finding by payment ID
      this.logger.log(`   Reservation not found by ID, trying payment ID: ${paymentId}`);
      seatLock = await this.seatLockModel.findOne({
        paymentIntentId: paymentId,
      }).exec();
      
      if (seatLock) {
        this.logger.log(`   ✅ Found reservation by payment ID: ${seatLock._id.toString()}`);
        reservationId = seatLock._id.toString(); // Update reservationId for later use
      }
    }
    
    if (!seatLock) {
      // Try backup collection
      if (paymentId) {
        const backupLock = await this.seatLockBackupModel.findOne({
          paymentIntentId: paymentId,
        }).exec();
        
        if (backupLock) {
          seatLock = await this.seatLockModel.findById(backupLock._id).exec();
          if (seatLock) {
            this.logger.log(`   ✅ Found reservation via backup collection: ${seatLock._id.toString()}`);
            reservationId = seatLock._id.toString();
          }
        }
      }
    }
    
    if (!seatLock) {
      // List recent reservations for debugging
      const recentReservations = await this.seatLockModel
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .select('_id status phoneNumber customerName paymentIntentId')
        .exec();
      
      this.logger.error(`❌ Reservation not found. Recent reservations:`);
      recentReservations.forEach((r: any) => {
        this.logger.error(`   - ${r._id} | Status: ${r.status} | PaymentID: ${r.paymentIntentId || 'N/A'}`);
      });
      
      throw new NotFoundException(
        `Reservation with ID ${reservationId} not found. ` +
        `Recent reservations: ${recentReservations.map((r: any) => r._id).join(', ')}`
      );
    }

    this.logger.log(`✅ Seat lock found:`);
    this.logger.log(`   Status: ${seatLock.status}`);
    this.logger.log(`   Payment Intent ID: ${seatLock.paymentIntentId || 'NOT SET'}`);
    this.logger.log(`   Phone Number: ${seatLock.phoneNumber || 'NOT SET'}`);
    this.logger.log(`   Customer Name: ${seatLock.customerName || 'NOT SET'}`);
    this.logger.log(`   Customer Email: ${seatLock.customerEmail || 'NOT SET'}`);

    // Use provided paymentId or the one from seatLock
    const finalPaymentId = paymentId || seatLock.paymentIntentId;
    
    if (!finalPaymentId) {
      throw new BadRequestException('Payment ID is required. Please provide paymentId or ensure seatLock has paymentIntentId');
    }

    // Check transaction status with Dialog Genie API
    const dialogGenieApiUrl = 
      this.configService.get<string>('DIALOG_GENIE_API_URL') || 
      process.env.DIALOG_GENIE_API_URL;
    
    const dialogGenieApiKey = 
      this.configService.get<string>('DIALOG_GENIE_API_KEY') || 
      process.env.DIALOG_GENIE_API_KEY;

    if (!dialogGenieApiUrl || !dialogGenieApiKey) {
      this.logger.warn(`⚠️  Dialog Genie API not configured. Skipping status check and proceeding with confirmation.`);
    } else {
      try {
        // Check transaction status
        this.logger.log(`🔍 Checking transaction status with Dialog Genie API...`);
        const statusUrl = `${dialogGenieApiUrl}/${finalPaymentId}`;
        this.logger.log(`   URL: ${statusUrl}`);
        
        const statusResponse = await axios.get(statusUrl, {
          headers: {
            'Authorization': `Bearer ${dialogGenieApiKey}`,
            'Content-Type': 'application/json',
          },
        });

        this.logger.log(`📊 Transaction Status Response:`);
        this.logger.log(`   ${JSON.stringify(statusResponse.data, null, 2)}`);

        const transactionStatus = statusResponse.data?.status || statusResponse.data?.transactionStatus;
        if (transactionStatus !== 'SUCCESS' && transactionStatus !== 'COMPLETED') {
          this.logger.warn(`⚠️  Transaction status is not SUCCESS. Status: ${transactionStatus}`);
          this.logger.warn(`   Proceeding with confirmation anyway for testing purposes.`);
        } else {
          this.logger.log(`✅ Transaction is successful! Status: ${transactionStatus}`);
        }
      } catch (error: any) {
        this.logger.warn(`⚠️  Failed to check transaction status: ${error.message}`);
        this.logger.warn(`   Proceeding with confirmation anyway for testing purposes.`);
      }
    }

    // Manually trigger booking confirmation
    this.logger.log(`🔄 Manually triggering booking confirmation...`);
    try {
      const result = await this.handleDialogGenieCallback({
        paymentId: finalPaymentId,
        status: 'SUCCESS', // Assume success for testing
      });

      this.logger.log(`✅ Booking confirmation completed!`);
      return {
        success: true,
        reservationId,
        paymentId: finalPaymentId,
        confirmation: result,
        message: 'Booking confirmed and Firebase message should be sent',
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to confirm booking: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get user phone number from Firestore user profile
   * Priority: mobile, phone, phoneNumber, mobileNumber, phone_number, mobile_number
   */
  private async getUserPhoneNumberFromProfile(buyerId: string): Promise<string | null> {
    try {
      const firestore = this.firebaseAdminService.getFirestore();
      if (!firestore) {
        this.logger.warn('Firestore not available, cannot fetch user phone number');
        return null;
      }

      // Get user document from Firestore users collection
      const userDoc = await firestore.collection('users').doc(buyerId).get();
      
      if (!userDoc.exists) {
        this.logger.warn(`User document not found in Firestore for buyerId: ${buyerId}`);
        return null;
      }

      const userData = userDoc.data();
      if (!userData) {
        this.logger.warn(`User document exists but has no data for buyerId: ${buyerId}`);
        return null;
      }

      // Try common field names for phone number
      const phoneNumber = 
        userData.mobile || 
        userData.phone || 
        userData.phoneNumber || 
        userData.mobileNumber ||
        userData.phone_number ||
        userData.mobile_number;

      if (phoneNumber) {
        this.logger.log(`Found phone number from user profile for buyerId ${buyerId}: ${phoneNumber}`);
        return String(phoneNumber);
      } else {
        this.logger.warn(`Phone number not found in user document for buyerId: ${buyerId}`);
        return null;
      }
    } catch (error: any) {
      this.logger.error(`Error fetching phone number from user profile for buyerId ${buyerId}: ${error.message}`);
      return null;
    }
  }
}
