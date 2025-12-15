import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as admin from 'firebase-admin';
import { SeatLock, SeatLockDocument, ReservationStatus, ReservationNumericState } from '../schemas/seat-lock.schema';
import { Booking, BookingDocument, PaymentState } from '../schemas/booking.schema';
import { Seat, SeatDocument } from '../schemas/seat.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { CreateBookingDto, UpdateTicketsDto } from '../dto/create-booking.dto';
import { SeatsService } from '../seats/seats.service';
import { EventsService } from '../events/events.service';
import { FirebaseMessageService } from '../firebase-message/firebase-message.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(SeatLock.name) private seatLockModel: Model<SeatLockDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    @InjectModel(Seat.name) private seatModel: Model<SeatDocument>,
    private seatsService: SeatsService,
    private eventsService: EventsService,
    private firebaseMessageService: FirebaseMessageService,
    private firebaseAdminService: FirebaseAdminService,
    private smsService: SmsService,
  ) {}

  async createReservation(createBookingDto: CreateBookingDto) {
    try {
      const { eventId, seatIds, buyerId, sessionId, holdSeconds = 600 } = createBookingDto;

      console.log('Creating reservation with:', { eventId, seatIds, holdSeconds });

      // Validate input
      if (!eventId) {
        throw new BadRequestException({ message: 'eventId is required', statusCode: 400 });
      }
      if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
        throw new BadRequestException({ message: 'seatIds must be a non-empty array', statusCode: 400 });
      }

      // Verify event exists
      const event = await this.eventsService.findOne(eventId);
      if (!event) {
        throw new NotFoundException(`Event with ID ${eventId} not found`);
      }

      // Check if ticket sales are enabled and within sale period
      const now = new Date();
      const isSalePeriodActive = 
        (!event.ticketSaleStartDate || new Date(event.ticketSaleStartDate) <= now) &&
        (!event.ticketSaleEndDate || new Date(event.ticketSaleEndDate) >= now);
      
      if (!event.isTicketSaleEnabled) {
        throw new BadRequestException({
          message: 'Ticket sales are currently disabled for this event',
          statusCode: 400,
        });
      }

      if (!isSalePeriodActive) {
        const message = event.ticketSaleStartDate && new Date(event.ticketSaleStartDate) > now
          ? `Ticket sales start on ${new Date(event.ticketSaleStartDate).toLocaleString()}`
          : event.ticketSaleEndDate && new Date(event.ticketSaleEndDate) < now
          ? `Ticket sales ended on ${new Date(event.ticketSaleEndDate).toLocaleString()}`
          : 'Ticket sales are not currently available';
        
        throw new BadRequestException({
          message,
          statusCode: 400,
        });
      }

      // Log event ticketTypes for debugging
      console.log('Event ticketTypes:', JSON.stringify(event.ticketTypes, null, 2));

      // Verify all seats exist and belong to event
      const seats = await this.seatsService.findByEventAndIds(eventId, seatIds);
      if (seats.length !== seatIds.length) {
        const foundSeatIds = seats.map(s => s._id.toString());
        const missingSeatIds = seatIds.filter(id => !foundSeatIds.includes(String(id)));
        throw new BadRequestException({
          message: 'Some seats not found or do not belong to this event',
          missingSeatIds,
          statusCode: 400,
        });
      }

      // Log seat ticketTypes for debugging
      console.log('Seats with ticketTypes:', seats.map(s => ({
        label: s.label,
        ticketType: s.ticketType,
        basePrice: s.basePrice
      })));

      // Generate reservation ID
      const reservationId = `reservation_${uuidv4()}`;
      const expiresAt = new Date(Date.now() + holdSeconds * 1000);

      // Atomically lock all seats
      const lockResult = await this.seatsService.atomicLockSeats(seatIds, reservationId);
      if (!lockResult.success) {
        const errorResponse = {
          message: 'Some seats are no longer available',
          unavailableSeats: lockResult.failedSeatIds,
        };
        console.error('Seats locking failed:', errorResponse);
        throw new BadRequestException(errorResponse);
      }

      // Calculate initial amount estimate (use full seat prices, adults/kids will be set later via updateTickets)
      // For initial calculation, we just sum all seat prices without adult/kid multipliers
      const amountSummary = this.calculateAmount(seats, event, seats.length, 0);

      // Create seat lock document
      const seatLock = new this.seatLockModel({
        _id: reservationId,
        eventId: new Types.ObjectId(eventId),
        buyerId,
        sessionId,
        seatIds,
        status: ReservationStatus.PENDING_PAYMENT,
        numericState: ReservationNumericState.CART_TO_PAYMENT, // -1: user selected seats, proceeding to payment
        expiresAt,
        amountSummary,
      });

      await seatLock.save();

      // Send SMS notification if buyerId is available
      if (buyerId) {
        try {
          const mobileNumber = await this.getCustomerMobileFromFirestore(buyerId);
          if (mobileNumber) {
            // Get event details for SMS
            const seatLabels = seats.map(seat => seat.label || `Seat ${seat._id}`);
            const eventDate = event.startAt || new Date();
            
            // Send SMS asynchronously (don't wait for it to complete)
            this.smsService.sendBookingConfirmation(
              mobileNumber,
              event.title,
              seatLabels,
              reservationId,
              eventDate,
              event.venue?.name || 'TBA',
            ).catch(error => {
              this.logger.error(`Failed to send SMS for reservation ${reservationId}: ${error.message}`);
            });
          }
        } catch (error: any) {
          // Log error but don't fail the reservation creation
          this.logger.warn(`Could not send SMS for reservation ${reservationId}: ${error.message}`);
        }
      }

      console.log('Reservation created successfully:', reservationId);
      return {
        reservationId,
        expiresAt,
        amountEstimate: amountSummary,
        seatIds,
      };
    } catch (error: any) {
      console.error('Error in createReservation:', error);
      console.error('Error details:', {
        name: error?.name,
        message: error?.message,
        response: error?.response,
      });
      
      // Re-throw NestJS exceptions as-is
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      // Wrap other errors in a proper format
      throw new BadRequestException({
        message: error?.message || 'Failed to create reservation',
        error: 'Internal server error',
        statusCode: 400,
      });
    }
  }

  async updateTickets(reservationId: string, updateTicketsDto: UpdateTicketsDto) {
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    if (seatLock.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Reservation is not in pending payment state');
    }

    // Get event and seats
    const event = await this.eventsService.findOne(seatLock.eventId.toString());
    const seats = await this.seatsService.findByEventAndIds(
      seatLock.eventId.toString(),
      seatLock.seatIds,
    );

    // If per-seat assignments are provided, use them; otherwise use total adults/kids
    let adults = updateTicketsDto.adults || 0;
    let kids = updateTicketsDto.kids || 0;
    
    if (updateTicketsDto.seatAssignments && updateTicketsDto.seatAssignments.length > 0) {
      // Count adults and kids from seat assignments
      adults = updateTicketsDto.seatAssignments.filter(a => a.ticketType === 'adult').length;
      kids = updateTicketsDto.seatAssignments.filter(a => a.ticketType === 'child').length;
    }

    // Recalculate amount with per-seat pricing if assignments provided
    const amountSummary = updateTicketsDto.seatAssignments && updateTicketsDto.seatAssignments.length > 0
      ? this.calculateAmountWithSeatAssignments(seats, event, updateTicketsDto.seatAssignments)
      : this.calculateAmount(seats, event, adults, kids);

    seatLock.amountSummary = amountSummary;
    await seatLock.save();

    return {
      reservationId,
      amountSummary,
    };
  }

  async confirmBooking(reservationId: string, paymentIntentId?: string) {
    this.logger.log(`🔄 confirmBooking called for reservation ${reservationId}`);
    
    // STEP 1: Read customer information from MongoDB SeatLock collection
    this.logger.log(`📖 ========== READING FROM MONGODB SEATLOCK ==========`);
    this.logger.log(`   Reading reservation ${reservationId} from MongoDB seatlocks collection...`);
    
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    // Log all customer information read from MongoDB
    this.logger.log(`✅ Successfully read from MongoDB SeatLock:`);
    this.logger.log(`   Reservation ID: ${seatLock._id.toString()}`);
    this.logger.log(`   Customer Name: ${seatLock.customerName || 'NOT SET'}`);
    this.logger.log(`   Customer Email: ${seatLock.customerEmail || 'NOT SET'}`);
    this.logger.log(`   Phone Number: ${seatLock.phoneNumber || 'NOT SET'}`);
    this.logger.log(`   Billing Email: ${seatLock.billingEmail || 'NOT SET'}`);
    this.logger.log(`   Billing Address: ${seatLock.billingAddress1 || 'NOT SET'}`);
    this.logger.log(`   Billing City: ${seatLock.billingCity || 'NOT SET'}`);
    this.logger.log(`   Billing Country: ${seatLock.billingCountry || 'NOT SET'}`);
    this.logger.log(`   Billing PostCode: ${seatLock.billingPostCode || 'NOT SET'}`);
    this.logger.log(`   Event ID: ${seatLock.eventId.toString()}`);
    this.logger.log(`   Seat IDs: ${seatLock.seatIds.join(', ')}`);
    this.logger.log(`   Status: ${seatLock.status}`);
    this.logger.log(`   Numeric State: ${seatLock.numericState}`);

    // Check if booking is already confirmed
    if (seatLock.status === ReservationStatus.COMPLETED) {
      this.logger.log(`Booking already confirmed for reservation ${reservationId}. Checking if bookings exist and are saved to Firestore.`);
      
      // Check if bookings exist in MongoDB
      const existingBookings = await this.bookingModel.find({ reservationId }).exec();
      
      if (existingBookings.length > 0) {
        this.logger.log(`Found ${existingBookings.length} existing booking(s) for reservation ${reservationId}`);
        
        // Note: We don't save bookings to Firestore - only SMS messages to pending_messages
        this.logger.log(`Bookings exist in MongoDB. SMS message will be sent if phone number is available.`);
        
        // Update payment intent ID if provided
        if (paymentIntentId && !seatLock.paymentIntentId) {
          seatLock.paymentIntentId = paymentIntentId;
          await seatLock.save();
        }
        
        return {
          reservationId,
          bookings: existingBookings.map(b => b._id),
          confirmedSeats: seatLock.seatIds,
        };
      } else {
        // Status is COMPLETED but no bookings exist - this is an error state
        this.logger.warn(`⚠️  Reservation ${reservationId} has COMPLETED status but no bookings found. Re-confirming...`);
        // Fall through to create bookings
      }
    }

    if (seatLock.status !== ReservationStatus.PENDING_PAYMENT && seatLock.status !== ReservationStatus.COMPLETED) {
      throw new BadRequestException(`Reservation is not in pending payment state. Current status: ${seatLock.status}`);
    }

    // Check if expired
    if (new Date() > seatLock.expiresAt) {
      await this.cancelReservation(reservationId);
      throw new BadRequestException('Reservation has expired');
    }

    // Atomically confirm seats
    const confirmedCount = await this.seatsService.atomicConfirmSeats(
      seatLock.seatIds,
      reservationId,
    );

    if (confirmedCount !== seatLock.seatIds.length) {
      throw new BadRequestException('Some seats could not be confirmed');
    }

    // Update seat lock status
    seatLock.status = ReservationStatus.COMPLETED;
    if (paymentIntentId) {
      seatLock.paymentIntentId = paymentIntentId;
    }
    await seatLock.save();

    // Check if bookings already exist for this reservation
    const existingBookings = await this.bookingModel.find({ reservationId }).exec();
    
    let bookings: BookingDocument[];
    
    if (existingBookings.length > 0) {
      this.logger.log(`Found ${existingBookings.length} existing booking(s) for reservation ${reservationId}. Using existing bookings.`);
      bookings = existingBookings;
    } else {
    // Create booking records (one per seat)
      this.logger.log(`Creating ${seatLock.seatIds.length} booking record(s) in MongoDB for reservation ${reservationId}`);
      bookings = await Promise.all(
      seatLock.seatIds.map(async (seatId) => {
          try {
        const seat = await this.seatsService.findOne(seatId);
            if (!seat) {
              throw new Error(`Seat ${seatId} not found`);
            }
            
        const amountSummary = seatLock.amountSummary || { total: 0, commission: 0 };
        const seatPrice = seat.basePrice || amountSummary.total / seatLock.seatIds.length;
        const commissionAmount = amountSummary.commission / seatLock.seatIds.length;

            const bookingData = {
          reservationId,
          eventId: seatLock.eventId,
          buyerId: seatLock.buyerId,
          seatId: new Types.ObjectId(seatId),
          pricePaid: seatPrice,
          commissionAmount,
          adultCount: 1, // Will be updated from seatLock if needed
          kidCount: 0,
          phoneNumber: seatLock.phoneNumber,
              customerName: seatLock.customerName,
              customerEmail: seatLock.customerEmail,
              billingEmail: seatLock.billingEmail,
              billingAddress1: seatLock.billingAddress1,
              billingCity: seatLock.billingCity,
              billingCountry: seatLock.billingCountry,
              billingPostCode: seatLock.billingPostCode,
          paymentState: PaymentState.PENDING, // Will be updated by payment callback
            };
            
            this.logger.log(`   Creating booking for seat ${seatId} with customer info: Name=${bookingData.customerName || 'NOT SET'}, Email=${bookingData.customerEmail || 'NOT SET'}, Phone=${bookingData.phoneNumber || 'NOT SET'}`);
            
            const booking = new this.bookingModel(bookingData);
            const savedBooking = await booking.save();
            
            // Verify the saved booking has customer info
            const verifyBooking = await this.bookingModel.findById(savedBooking._id).exec();
            if (verifyBooking) {
              this.logger.log(`   ✅ Verified booking ${savedBooking._id.toString()} saved with: Name=${verifyBooking.customerName || 'NOT SET'}, Email=${verifyBooking.customerEmail || 'NOT SET'}, Phone=${verifyBooking.phoneNumber || 'NOT SET'}`);
            }
            
            return savedBooking;
          } catch (error: any) {
            this.logger.error(`❌ Failed to create booking for seat ${seatId}: ${error.message}`, error.stack);
            throw error;
          }
      }),
    );
    }

    this.logger.log(`✅ Successfully created ${bookings.length} booking(s) in MongoDB. Booking IDs: ${bookings.map(b => b._id.toString()).join(', ')}`);

    // STEP 2: Save to Firebase Firestore using data from MongoDB SeatLock
    // This is the only Firestore save we need - for SMS sending by another app
    this.logger.log(``);
    this.logger.log(`📱 ========== SAVING TO FIREBASE FIRESTORE ==========`);
    this.logger.log(`   Using customer information from MongoDB SeatLock collection`);
    this.logger.log(`   Reservation ID: ${reservationId}`);
    this.logger.log(`   Seat Lock ID: ${seatLock._id.toString()}`);
    this.logger.log(`   Phone number (from MongoDB): ${seatLock.phoneNumber || 'NOT SET'}`);
    this.logger.log(`   Customer Name (from MongoDB): ${seatLock.customerName || 'NOT SET'}`);
    this.logger.log(`   Customer Email (from MongoDB): ${seatLock.customerEmail || 'NOT SET'}`);
    this.logger.log(`   Event ID (from MongoDB): ${seatLock.eventId.toString()}`);
    this.logger.log(`   Seat IDs (from MongoDB): ${seatLock.seatIds.join(', ')}`);
    
    // Validate required data from MongoDB
    if (!seatLock.phoneNumber) {
      this.logger.error(`❌ ========== CANNOT SAVE TO FIREBASE ==========`);
      this.logger.error(`   Phone number is NOT SET in MongoDB SeatLock!`);
      this.logger.error(`   Reservation ID: ${reservationId}`);
      this.logger.error(`   Seat Lock ID: ${seatLock._id.toString()}`);
      this.logger.error(`   This booking will NOT be saved to Firebase Firestore!`);
      this.logger.error(`   Please ensure customer information is saved to MongoDB SeatLock before payment confirmation.`);
      throw new Error(`Phone number is required to save booking to Firebase. Reservation ID: ${reservationId}`);
    }

    // Check Firebase initialization - CRITICAL CHECK
    const isFirebaseInitialized = this.firebaseAdminService.isInitialized();
    this.logger.log(`   Firebase initialized: ${isFirebaseInitialized ? '✅ YES' : '❌ NO'}`);
    
    if (!isFirebaseInitialized) {
      this.logger.error(`❌ ========== FIREBASE NOT INITIALIZED ==========`);
      this.logger.error(`   Firebase Admin SDK is not initialized!`);
      this.logger.error(`   This booking will NOT be saved to Firebase Firestore!`);
      this.logger.error(`   Reservation ID: ${reservationId}`);
      this.logger.error(`   Please check Firebase configuration and ensure FIREBASE_SERVICE_ACCOUNT_PATH is set correctly.`);
      throw new Error(`Firebase is not initialized. Cannot save booking to Firestore. Reservation ID: ${reservationId}`);
    }
    
    // Double-check Firestore is available
    const firestore = this.firebaseAdminService.getFirestore();
    if (!firestore) {
      this.logger.error(`❌ ========== FIRESTORE NOT AVAILABLE ==========`);
      this.logger.error(`   Firebase is initialized but Firestore instance is NULL!`);
      this.logger.error(`   This booking will NOT be saved to Firebase Firestore!`);
      this.logger.error(`   Reservation ID: ${reservationId}`);
      throw new Error(`Firestore is not available. Cannot save booking to Firestore. Reservation ID: ${reservationId}`);
    }
    this.logger.log(`   ✅ Firestore instance is available`);

    // Save to Firebase using data from MongoDB SeatLock - this is CRITICAL and must succeed
    try {
      this.logger.log(`📱 Preparing SMS message for Firebase using MongoDB SeatLock data`);
      this.logger.log(`   Phone (from MongoDB SeatLock): ${seatLock.phoneNumber}`);
      this.logger.log(`   Event ID (from MongoDB SeatLock): ${seatLock.eventId.toString()}`);
      this.logger.log(`   Seat IDs (from MongoDB SeatLock): ${seatLock.seatIds.join(', ')}`);
      
      // Get event details for the message
      const event = await this.eventsService.findOne(seatLock.eventId.toString());
      if (!event) {
        this.logger.error(`❌ Event not found for ID: ${seatLock.eventId.toString()}`);
        throw new Error(`Event not found for ID: ${seatLock.eventId.toString()}`);
      }
      
      this.logger.log(`   Event found: ${event.title}`);
      this.logger.log(`   Event venue: ${event.venue?.name || 'TBA'}`);
      
      // Get seat labels
      const seats = await Promise.all(
        seatLock.seatIds.map(seatId => this.seatsService.findOne(seatId))
      );
      const seatLabels = seats.map(seat => seat.label || `Seat ${seat._id}`);
      this.logger.log(`   Seat labels: ${seatLabels.join(', ')}`);

      // Build message data from MongoDB SeatLock
      const messageData = {
          phone: seatLock.phoneNumber, // From MongoDB SeatLock
          eventId: seatLock.eventId.toString(), // From MongoDB SeatLock
          eventName: event.title,
          venue: event.venue?.name || 'TBA',
          seats: seatLabels,
      };
      
      this.logger.log(`📤 Sending to Firebase Message Service (data from MongoDB SeatLock):`);
      this.logger.log(`   ${JSON.stringify(messageData, null, 2)}`);

      const messageResult = await this.firebaseMessageService.sendBookingMessage(messageData);

      if (messageResult) {
        this.logger.log(`✅ ========== FIREBASE SAVE SUCCESSFUL ==========`);
        this.logger.log(`   ✅ Successfully read customer data from MongoDB SeatLock collection`);
        this.logger.log(`   ✅ Successfully saved SMS message to Firebase pending_messages collection with status 'success'`);
        this.logger.log(`   Data flow: MongoDB SeatLock → Firebase Firestore (status: success)`);
        this.logger.log(`   Phone (from MongoDB): ${messageData.phone}`);
        this.logger.log(`   Event (from MongoDB): ${messageData.eventName}`);
        this.logger.log(`   Venue: ${messageData.venue}`);
        this.logger.log(`   Seats (from MongoDB): ${messageData.seats.join(', ')}`);
        this.logger.log(`   Note: Status is initially 'success'. Will be updated to 'failed' if SMS sending fails.`);
      } else {
        this.logger.error(`❌ ========== FIREBASE SAVE FAILED ==========`);
        this.logger.error(`   sendBookingMessage returned false`);
        this.logger.error(`   Reservation ID: ${reservationId}`);
        this.logger.error(`   Data was read from MongoDB SeatLock but failed to save to Firestore`);
        throw new Error(`Failed to save booking message to Firebase. sendBookingMessage returned false.`);
      }

      // Send SMS via Dialog eSMS (as primary SMS provider)
      if (seatLock.phoneNumber) {
        try {
          this.logger.log(``);
          this.logger.log(`📱 ========== SENDING SMS VIA DIALOG ESMS ==========`);
          this.logger.log(`   Phone: ${seatLock.phoneNumber}`);
          this.logger.log(`   Event: ${event.title}`);
          this.logger.log(`   Venue: ${event.venue?.name || 'TBA'}`);
          this.logger.log(`   Seats: ${seatLabels.join(', ')}`);
          
          // Get event date (use startAt or a default)
          const eventDate = event.startAt || new Date();
          
          const smsResult = await this.smsService.sendBookingConfirmation(
            seatLock.phoneNumber,
            event.title,
            seatLabels,
            reservationId,
            eventDate,
            event.venue?.name || 'TBA',
          );

          // Update Firestore status based on SMS result
          if (smsResult) {
            this.logger.log(`✅ SMS sent successfully via Dialog eSMS`);
            // Status is already 'success' from initial save, no update needed
          } else {
            this.logger.warn(`⚠️  SMS sending failed, but booking is still confirmed`);
            // Update Firestore status to 'failed' if SMS sending failed
            try {
              const firestore = this.firebaseAdminService.getFirestore();
              if (firestore) {
                // Find the document by phone and eventId
                const snapshot = await firestore
                  .collection('pending_messages')
                  .where('phone', '==', seatLock.phoneNumber)
                  .where('eventId', '==', seatLock.eventId.toString())
                  .where('status', '==', 'success')
                  .orderBy('timestamp', 'desc')
                  .limit(1)
                  .get();

                if (!snapshot.empty) {
                  const doc = snapshot.docs[0];
                  await doc.ref.update({
                    status: 'failed',
                    updatedAt: new Date(),
                    errorMessage: 'SMS sending failed via Dialog eSMS',
                  });
                  this.logger.log(`⚠️  Updated Firestore document ${doc.id} status to 'failed'`);
                }
              }
            } catch (updateError: any) {
              this.logger.error(`❌ Failed to update Firestore status to 'failed': ${updateError.message}`);
            }
          }
        } catch (smsError: any) {
          // Don't fail the booking if SMS fails
          this.logger.error(`❌ Failed to send SMS via Dialog eSMS: ${smsError.message}`);
          this.logger.error(`   Booking is still confirmed, but SMS was not sent`);
        }
      } else {
        this.logger.warn(`⚠️  Phone number not available, skipping SMS send`);
      }
    } catch (error: any) {
      this.logger.error(`❌ ========== CRITICAL ERROR SAVING TO FIREBASE ==========`);
      this.logger.error(`   Error: ${error.message}`);
      this.logger.error(`   Stack: ${error.stack}`);
      this.logger.error(`   Error name: ${error.name}`);
      this.logger.error(`   Error code: ${error.code}`);
      this.logger.error(`   Reservation ID: ${reservationId}`);
      this.logger.error(`   Phone Number: ${seatLock.phoneNumber || 'NOT SET'}`);
      this.logger.error(`   This is a CRITICAL error - booking data was NOT saved to Firebase!`);
      // Re-throw to ensure the error is not silently ignored
      throw error;
    }

    return {
      reservationId,
      bookings: bookings.map(b => b._id),
      confirmedSeats: seatLock.seatIds,
    };
  }

  /**
   * Send SMS for a reservation (can be called independently)
   */
  async sendSmsForReservation(
    reservationId: string,
    phoneNumber: string,
    eventTitle: string,
    seatLabels: string[],
    eventDate: Date,
    venueName: string,
  ): Promise<boolean> {
    this.logger.log(`📱 ========== SENDING SMS FOR RESERVATION ==========`);
    this.logger.log(`   Reservation ID: ${reservationId}`);
    this.logger.log(`   Phone: ${phoneNumber}`);
    this.logger.log(`   Event: ${eventTitle}`);
    this.logger.log(`   Venue: ${venueName}`);
    this.logger.log(`   Seats: ${seatLabels.join(', ')}`);

    try {
      const smsResult = await this.smsService.sendBookingConfirmation(
        phoneNumber,
        eventTitle,
        seatLabels,
        reservationId,
        eventDate,
        venueName,
      );

      if (smsResult) {
        this.logger.log(`✅ SMS sent successfully for reservation ${reservationId}`);
        return true;
      } else {
        this.logger.warn(`⚠️  SMS sending returned false for reservation ${reservationId}`);
        return false;
      }
    } catch (error: any) {
      this.logger.error(`❌ Failed to send SMS for reservation ${reservationId}: ${error.message}`);
      throw error;
    }
  }

  async cancelReservation(reservationId: string) {
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    // Release seats
    await this.seatsService.releaseSeatsByReservation(reservationId);

    // Update status
    seatLock.status = ReservationStatus.CANCELLED;
    await seatLock.save();

    return { reservationId, cancelled: true };
  }

  async getReservation(reservationId: string) {
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    return {
      reservationId: seatLock._id,
      eventId: seatLock.eventId.toString(),
      seatIds: seatLock.seatIds,
      status: seatLock.status,
      expiresAt: seatLock.expiresAt,
      amountEstimate: seatLock.amountSummary,
    };
  }

  async getBookingDetails(reservationId: string) {
    const seatLock = await this.seatLockModel.findById(reservationId).exec();
    if (!seatLock) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    // Get event details
    const event = await this.eventsService.findOne(seatLock.eventId.toString());
    
    // Get bookings
    const bookings = await this.bookingModel.find({ reservationId }).populate('seatId').exec();
    
    // Get seats
    const seats = await this.seatsService.findByEventAndIds(
      seatLock.eventId.toString(),
      seatLock.seatIds,
    );

    return {
      reservationId: seatLock._id,
      event,
      bookings: bookings.map(b => {
        const bookingObj = b.toObject ? b.toObject() : b;
        return {
          bookingId: b._id,
          seatId: b.seatId,
          pricePaid: b.pricePaid,
          commissionAmount: b.commissionAmount,
          adultCount: b.adultCount,
          kidCount: b.kidCount,
          createdAt: (bookingObj as any).createdAt || new Date(),
        };
      }),
      seats,
      amountSummary: seatLock.amountSummary,
      paymentIntentId: seatLock.paymentIntentId,
      createdAt: (seatLock as any).createdAt || new Date(),
    };
  }

  async getAvailability(eventId: string) {
    const seats = await this.seatsService.findAllByEvent(eventId);
    return {
      eventId,
      seats: seats.map(seat => ({
        _id: seat._id,
        label: seat.label,
        state: seat.state,
        pendingReservationId: seat.pendingReservationId,
      })),
    };
  }

  /**
   * Get customer mobile number from Firestore using buyerId
   */
  private async getCustomerMobileFromFirestore(buyerId: string): Promise<string | null> {
    try {
      const firestore = this.firebaseAdminService.getFirestore();
      if (!firestore) {
        this.logger.warn('Firestore not available, cannot fetch customer mobile number');
        return null;
      }

      // Try to get user document from Firestore users collection
      // Common field names: mobile, phone, phoneNumber, mobileNumber
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

      // Try common field names for mobile number
      const mobileNumber = 
        userData.mobile || 
        userData.phone || 
        userData.phoneNumber || 
        userData.mobileNumber ||
        userData.phone_number ||
        userData.mobile_number;

      if (mobileNumber) {
        this.logger.log(`Found mobile number from Firestore for buyerId ${buyerId}: ${mobileNumber}`);
        return String(mobileNumber);
      } else {
        this.logger.warn(`Mobile number not found in user document for buyerId: ${buyerId}`);
        return null;
      }
    } catch (error: any) {
      this.logger.error(`Error fetching customer mobile from Firestore for buyerId ${buyerId}: ${error.message}`);
      return null;
    }
  }

  private calculateAmount(
    seats: SeatDocument[],
    event: EventDocument,
    adults: number,
    kids: number,
  ) {
    // Convert event to plain object to handle Mongoose subdocuments
    const eventObj = event.toObject ? event.toObject() : event;
    
    // Build a map of ticket types for quick lookup (with adult and child prices)
    const ticketTypeMap = new Map<string, { adultPrice: number; childPrice: number }>();
    if (eventObj.ticketTypes && Array.isArray(eventObj.ticketTypes)) {
      eventObj.ticketTypes.forEach((tt: any) => {
        // Handle both Mongoose subdocuments and plain objects
        const name = tt.name || (tt.toObject ? tt.toObject().name : null);
        const adultPrice = typeof tt.adultPrice === 'number' ? tt.adultPrice : (tt.toObject ? tt.toObject().adultPrice : null);
        const childPrice = typeof tt.childPrice === 'number' ? tt.childPrice : (tt.toObject ? tt.toObject().childPrice : null);
        if (name && adultPrice !== null && adultPrice !== undefined && childPrice !== null && childPrice !== undefined) {
          ticketTypeMap.set(String(name), { adultPrice: Number(adultPrice), childPrice: Number(childPrice) });
        }
      });
    }

    console.log('CalculateAmount - Event ticketTypes:', JSON.stringify(eventObj.ticketTypes, null, 2));
    console.log('CalculateAmount - TicketTypeMap:', Array.from(ticketTypeMap.entries()));

    // Calculate subtotal: sum of seat prices based on ticket types
    const adultMultiplier = 1.0;
    const kidMultiplier = 0.5; // 50% for kids (configurable)

    // Calculate base price for each seat
    const seatPrices = seats.map(seat => {
      const seatObj = seat.toObject ? seat.toObject() : seat;
      const seatTicketType = seatObj.ticketType ? String(seatObj.ticketType).trim() : null;
      const seatBasePrice = seatObj.basePrice;
      
      console.log(`Seat ${seatObj.label}: basePrice=${seatBasePrice}, ticketType="${seatTicketType}"`);
      
      // Priority: ticketType price > seat.basePrice > event.defaultPrice
      // Ticket type takes precedence because it's explicitly assigned by the organizer
      if (seatTicketType && ticketTypeMap.has(seatTicketType)) {
        const ticketPrices = ticketTypeMap.get(seatTicketType)!;
        // Use adult price as default (per-seat assignment will override this)
        const ticketPrice = ticketPrices.adultPrice;
        console.log(`  Using ticketType "${seatTicketType}" adult price: ${ticketPrice}`);
        return ticketPrice;
      }
      // If no ticket type, use basePrice if set
      if (seatBasePrice && seatBasePrice > 0) {
        console.log(`  Using basePrice: ${seatBasePrice}`);
        return Number(seatBasePrice);
      }
      // Fallback to default price
      const defaultPrice = eventObj.defaultPrice || 0;
      console.log(`  Using defaultPrice: ${defaultPrice}`);
      return Number(defaultPrice);
    });

    console.log('Seat prices:', seatPrices);
    const baseSubtotal = seatPrices.reduce((sum, price) => sum + price, 0);
    console.log('Base subtotal:', baseSubtotal);

    // Apply adult/kid pricing if specified
    // The base subtotal is already the sum of all seat prices
    // Adult/kid multipliers should only apply if we need to adjust per-person pricing
    // For now, we use the base subtotal directly since each seat has its own price
    let adjustedSubtotal = baseSubtotal;
    
    // Only apply adult/kid pricing if the number of persons doesn't match seats
    // This handles cases like group discounts or per-person pricing models
    const totalPersons = adults + kids;
    if (totalPersons > 0 && totalPersons !== seats.length) {
      // If persons don't match seats, calculate average and apply multipliers
      const avgSeatPrice = baseSubtotal / seats.length;
      adjustedSubtotal = (adults * avgSeatPrice * adultMultiplier) + (kids * avgSeatPrice * kidMultiplier);
      console.log(`Applied adult/kid pricing: ${totalPersons} persons for ${seats.length} seats`);
    } else {
      // Normal case: each seat = one person, use full seat prices
      adjustedSubtotal = baseSubtotal;
      console.log(`Using full seat prices: ${seats.length} seats`);
    }
    
    console.log('Adjusted subtotal:', adjustedSubtotal);

    // Calculate commission
    let commission = 0;
    if (event.commission) {
      if (event.commission.type === 'percentage') {
        commission = adjustedSubtotal * (event.commission.value / 100);
      } else {
        commission = event.commission.value * seats.length;
      }
    }

    const taxes = 0; // Can be configured
    const total = adjustedSubtotal + commission + taxes;

    return {
      subtotal: adjustedSubtotal,
      commission,
      taxes,
      total,
    };
  }

  private calculateAmountWithSeatAssignments(
    seats: SeatDocument[],
    event: EventDocument,
    seatAssignments: Array<{ seatId: string; ticketType: 'adult' | 'child' }>,
  ) {
    const eventObj = event.toObject ? event.toObject() : event;
    
    // Build a map of ticket types for quick lookup (with adult and child prices)
    const ticketTypeMap = new Map<string, { adultPrice: number; childPrice: number }>();
    if (eventObj.ticketTypes && Array.isArray(eventObj.ticketTypes)) {
      eventObj.ticketTypes.forEach((tt: any) => {
        const name = tt.name || (tt.toObject ? tt.toObject().name : null);
        const adultPrice = typeof tt.adultPrice === 'number' ? tt.adultPrice : (tt.toObject ? tt.toObject().adultPrice : null);
        const childPrice = typeof tt.childPrice === 'number' ? tt.childPrice : (tt.toObject ? tt.toObject().childPrice : null);
        if (name && adultPrice !== null && adultPrice !== undefined && childPrice !== null && childPrice !== undefined) {
          ticketTypeMap.set(String(name), { adultPrice: Number(adultPrice), childPrice: Number(childPrice) });
        }
      });
    }

    // Create a map of seat assignments
    const assignmentMap = new Map<string, 'adult' | 'child'>();
    seatAssignments.forEach(assignment => {
      assignmentMap.set(String(assignment.seatId), assignment.ticketType);
    });

    // Calculate price for each seat based on its assignment
    let subtotal = 0;
    seats.forEach(seat => {
      const seatObj = seat.toObject ? seat.toObject() : seat;
      const seatId = String(seat._id);
      const ticketType = assignmentMap.get(seatId) || 'adult'; // Default to adult if not assigned
      const seatTicketType = seatObj.ticketType ? String(seatObj.ticketType).trim() : null;
      
      let price = 0;
      
      // Priority: ticketType price > seat.basePrice > event.defaultPrice
      if (seatTicketType && ticketTypeMap.has(seatTicketType)) {
        const prices = ticketTypeMap.get(seatTicketType)!;
        price = ticketType === 'adult' ? prices.adultPrice : prices.childPrice;
      } else if (seatObj.basePrice && seatObj.basePrice > 0) {
        // If no ticket type, use same basePrice for both adult and child
        price = Number(seatObj.basePrice);
      } else {
        // Fallback to default price (same for both adult and child if no ticket type)
        const defaultPrice = eventObj.defaultPrice || 0;
        price = defaultPrice;
      }
      
      subtotal += price;
    });

    // Calculate commission
    let commission = 0;
    if (event.commission) {
      if (event.commission.type === 'percentage') {
        commission = subtotal * (event.commission.value / 100);
      } else {
        commission = event.commission.value * seats.length;
      }
    }

    const taxes = 0; // Can be configured
    const total = subtotal + commission + taxes;

    return {
      subtotal,
      commission,
      taxes,
      total,
    };
  }

}

