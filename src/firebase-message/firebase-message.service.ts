import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';

export interface SendBookingMessageDto {
  phone: string;
  eventId: string;
  eventName: string;
  venue: string;
  seats: string[];
  message?: string; // Optional, will be formatted if not provided
}

export interface PendingMessageDocument {
  phone: string;
  message: string;
  eventId: string;
  eventName: string;
  venue: string;
  seats: string[];
  timestamp: number;
  status: 'success' | 'pending' | 'failed';
  sentAt?: Date;
  updatedAt?: Date;
  transactionId?: string;
  errorMessage?: string;
}

@Injectable()
export class FirebaseMessageService {
  private readonly logger = new Logger(FirebaseMessageService.name);
  private readonly collectionName = 'pending_messages';

  constructor(private firebaseAdminService: FirebaseAdminService) {}

  /**
   * Format booking confirmation message
   */
  formatBookingMessage(eventName: string, venue: string, seatList: string[]): string {
    const seatText = seatList.length === 1 
      ? seatList[0] 
      : seatList.join(', ');
    
    return `Your booking is confirmed for ${eventName} at ${venue}. Seats: ${seatText}. Thank you!`;
  }

  /**
   * Send booking message by creating a pending message document in Firestore
   */
  async sendBookingMessage(dto: SendBookingMessageDto): Promise<boolean> {
    try {
      // Log what we received
      this.logger.log(`📥 Received data for Firebase SMS message:`);
      this.logger.log(`   Input DTO: ${JSON.stringify(dto, null, 2)}`);
      this.logger.log(`   Phone: ${dto.phone || 'NOT PROVIDED'}`);
      this.logger.log(`   Event ID: ${dto.eventId || 'NOT PROVIDED'}`);
      this.logger.log(`   Event Name: ${dto.eventName || 'NOT PROVIDED'}`);
      this.logger.log(`   Venue: ${dto.venue || 'NOT PROVIDED'}`);
      this.logger.log(`   Seats: ${dto.seats ? dto.seats.join(', ') : 'NOT PROVIDED'}`);
      this.logger.log(`   Custom Message: ${dto.message || 'Will be auto-formatted'}`);
      
      // Format message if not provided
      const message = dto.message || this.formatBookingMessage(
        dto.eventName,
        dto.venue,
        dto.seats,
      );
      
      this.logger.log(`   Formatted Message: ${message}`);

      // Create message document with initial status as 'success'
      // Since SMS is sent immediately after saving, we mark it as success initially
      // If SMS fails, we'll update the status to 'failed' later
      const pendingMessage: PendingMessageDocument = {
        phone: dto.phone,
        message,
        eventId: dto.eventId,
        eventName: dto.eventName,
        venue: dto.venue,
        seats: dto.seats,
        timestamp: Date.now(),
        status: 'success', // Changed from 'pending' to 'success' - SMS is sent immediately
        sentAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Log the complete document that will be saved
      this.logger.log(`📦 Complete Firebase document to save:`);
      this.logger.log(`   ${JSON.stringify(pendingMessage, null, 2)}`);

      // Write to Firestore if initialized, otherwise just log
      this.logger.log(`🔍 Checking Firebase initialization status...`);
      const isInitialized = this.firebaseAdminService.isInitialized();
      this.logger.log(`   Firebase initialized: ${isInitialized ? '✅ YES' : '❌ NO'}`);
      
      const firestore = this.firebaseAdminService.getFirestore();
      this.logger.log(`   Firestore instance: ${firestore ? '✅ Available' : '❌ NULL'}`);
      
      if (!firestore) {
        // CRITICAL: Firestore is not available - this is a failure
        this.logger.error(`❌ ========== FIRESTORE NOT AVAILABLE ==========`);
        this.logger.error(`   Firestore instance is NULL - cannot save message!`);
        this.logger.error(`   Firebase initialized: ${isInitialized}`);
        this.logger.error(`   This message will NOT be saved to Firebase Firestore!`);
        this.logger.error(`   Message content (NOT saved): ${JSON.stringify(pendingMessage, null, 2)}`);
        this.logger.error(`   Please check Firebase configuration and initialization.`);
        return false; // Return false to indicate failure
      }
      
      try {
        this.logger.log(`📱 Saving SMS message to Firebase pending_messages collection:`);
        this.logger.log(`   Collection: ${this.collectionName}`);
        this.logger.log(`   Phone: ${pendingMessage.phone}`);
        this.logger.log(`   Event: ${pendingMessage.eventName} (${pendingMessage.eventId})`);
        this.logger.log(`   Venue: ${pendingMessage.venue}`);
        this.logger.log(`   Seats: ${pendingMessage.seats.join(', ')}`);
        this.logger.log(`   Message: ${pendingMessage.message}`);
        this.logger.log(`   Timestamp: ${pendingMessage.timestamp}`);
        this.logger.log(`   Status: ${pendingMessage.status} (initially set to 'success' - will be updated to 'failed' if SMS sending fails)`);
        
        const docRef = await firestore
          .collection(this.collectionName)
          .add(pendingMessage);
        
        this.logger.log(`✅ ========== SUCCESSFULLY SAVED TO FIREBASE FIRESTORE ==========`);
        this.logger.log(`   Collection: ${this.collectionName}`);
        this.logger.log(`   Document ID: ${docRef.id}`);
        this.logger.log(`   Document Path: ${docRef.path}`);
        this.logger.log(`   Saved Data:`);
        this.logger.log(`     - phone: ${pendingMessage.phone}`);
        this.logger.log(`     - eventId: ${pendingMessage.eventId}`);
        this.logger.log(`     - eventName: ${pendingMessage.eventName}`);
        this.logger.log(`     - venue: ${pendingMessage.venue}`);
        this.logger.log(`     - seats: [${pendingMessage.seats.join(', ')}]`);
        this.logger.log(`     - message: ${pendingMessage.message}`);
        this.logger.log(`     - timestamp: ${pendingMessage.timestamp}`);
        this.logger.log(`     - status: ${pendingMessage.status}`);
        
        return true;
      } catch (firestoreError: any) {
        this.logger.error(`❌ ========== FIRESTORE SAVE ERROR ==========`);
        this.logger.error(`   Error message: ${firestoreError.message}`);
        this.logger.error(`   Error code: ${firestoreError.code || 'N/A'}`);
        this.logger.error(`   Error stack: ${firestoreError.stack}`);
        this.logger.error(`   Collection: ${this.collectionName}`);
        this.logger.error(`   Message content (NOT saved): ${JSON.stringify(pendingMessage, null, 2)}`);
        this.logger.error(`   This is a CRITICAL error - the message was NOT saved to Firestore!`);
        return false;
      }
    } catch (error: any) {
      this.logger.error(`❌ ========== CRITICAL ERROR IN sendBookingMessage ==========`);
      this.logger.error(`   Error message: ${error.message}`);
      this.logger.error(`   Error name: ${error.name}`);
      this.logger.error(`   Error code: ${error.code || 'N/A'}`);
      this.logger.error(`   Error stack: ${error.stack}`);
      this.logger.error(`   This error occurred before attempting to save to Firestore.`);
      return false;
    }
  }
}

