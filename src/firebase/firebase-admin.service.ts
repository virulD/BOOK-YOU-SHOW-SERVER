import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initialize();
  }

  async initialize(): Promise<boolean> {
    // Check if already initialized
    if (admin.apps.length > 0) {
      this.logger.log('Firebase Admin already initialized');
      this.initialized = true;
      return true;
    }

    if (this.initialized) {
      return true;
    }

    try {
      const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
      const firebaseConfig = this.configService.get<string>('FIREBASE_CONFIG');

      if (serviceAccountPath) {
        const fs = require('fs');
        const path = require('path');
        const serviceAccountPathResolved = path.isAbsolute(serviceAccountPath)
          ? serviceAccountPath
          : path.resolve(process.cwd(), serviceAccountPath);

        this.logger.log(`Attempting to initialize Firebase from: ${serviceAccountPathResolved}`);

        if (fs.existsSync(serviceAccountPathResolved)) {
          const serviceAccount = JSON.parse(
            fs.readFileSync(serviceAccountPathResolved, 'utf8'),
          );
          
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id,
          });

          this.initialized = true;
          this.logger.log(`✅ Firebase Admin initialized successfully from service account`);
          this.logger.log(`   Project ID: ${serviceAccount.project_id}`);
          this.logger.log(`   Client Email: ${serviceAccount.client_email}`);
          
          // Verify Firestore is available
          try {
            const firestore = admin.firestore();
            this.logger.log(`✅ Firestore service is available`);
            this.logger.log(`   Firestore instance created for project: ${serviceAccount.project_id}`);
            return true;
          } catch (error: any) {
            this.logger.error(`❌ Firestore service not available: ${error.message}`);
            this.logger.error(`   Error: ${error.stack}`);
            return false;
          }
        } else {
          this.logger.error(`❌ Firebase service account file not found at: ${serviceAccountPathResolved}`);
          this.logger.error(`   Current working directory: ${process.cwd()}`);
          return false;
        }
      } else if (firebaseConfig) {
        const config = JSON.parse(firebaseConfig);
        admin.initializeApp({
          credential: admin.credential.cert(config),
          projectId: config.project_id,
        });
        this.initialized = true;
        this.logger.log('✅ Firebase Admin initialized from config');
        return true;
      } else {
        // Try default credentials
        try {
          admin.initializeApp();
          this.initialized = true;
          this.logger.log('✅ Firebase Admin initialized with default credentials');
          return true;
        } catch (error) {
          this.logger.error('❌ Firebase credentials not found. FCM messaging will not be available.');
          return false;
        }
      }
    } catch (error: any) {
      this.logger.error('❌ Failed to initialize Firebase Admin:', error.message);
      this.logger.error('   Stack:', error.stack);
      return false;
    }
  }

  getMessaging(): admin.messaging.Messaging | null {
    if (!this.initialized || admin.apps.length === 0) {
      this.logger.warn('Firebase Admin not initialized. Cannot get messaging service.');
      return null;
    }
    return admin.messaging();
  }

  getFirestore(): admin.firestore.Firestore | null {
    if (!this.initialized || admin.apps.length === 0) {
      this.logger.warn('Firebase Admin not initialized. Cannot get Firestore service.');
      return null;
    }
    return admin.firestore();
  }

  isInitialized(): boolean {
    return this.initialized && admin.apps.length > 0;
  }
}


