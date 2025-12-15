import { Module, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventsModule } from './events/events.module';
import { SeatsModule } from './seats/seats.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { TicketsModule } from './tickets/tickets.module';
import { AuthModule } from './auth/auth.module';
import { TeamManagementModule } from './team-management/team-management.module';
import { MessagingModule } from './messaging/messaging.module';
import { FirebaseModule } from './firebase/firebase.module';
import { DialogEsmsModule } from './dialog-esms/dialog-esms.module';
import { SmsModule } from './sms/sms.module';
import { RedisModule } from './redis/redis.module';
import appConfig from './config/app.config';
import * as path from 'path';
import * as fs from 'fs';

const logger = new Logger('AppModule');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), 'server.env'),
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, '..', 'server.env'),
      ], // Try multiple paths
      load: [appConfig],
      cache: true,
    }),
    FirebaseModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        // Try multiple ways to get the MongoDB URI
        const mongoUri = 
          configService.get<string>('MONGODB_URI') || 
          process.env.MONGODB_URI || 
          'mongodb://localhost:27017/bookyourshow';
        
        const maskedUri = mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
        console.log('═══════════════════════════════════════');
        console.log('🔗 MongoDB Connection:');
        console.log('   URI:', maskedUri);
        console.log('   Source:', configService.get('MONGODB_URI') ? 'ConfigService' : (process.env.MONGODB_URI ? 'process.env' : 'DEFAULT'));
        console.log('═══════════════════════════════════════');
        
        return {
          uri: mongoUri,
        };
      },
      inject: [ConfigService],
    }),
    EventsModule,
    SeatsModule,
    BookingsModule,
    PaymentsModule,
    TicketsModule,
    AuthModule,
    TeamManagementModule,
    MessagingModule,
    DialogEsmsModule,
    SmsModule,
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  constructor(private configService: ConfigService) {
    // Debug environment variable loading
    this.debugEnvironmentVariables();
  }

  private debugEnvironmentVariables() {
    logger.log('═══════════════════════════════════════');
    logger.log('🔍 Environment Variable Debug Info');
    logger.log('═══════════════════════════════════════');

    // Check if env files exist
    const envFiles = [
      path.join(process.cwd(), '.env'),
      path.join(process.cwd(), 'server.env'),
      path.join(__dirname, '..', '.env'),
      path.join(__dirname, '..', 'server.env'),
    ];

    logger.log('📁 Checking env files:');
    let foundEnvFile: string | null = null;
    envFiles.forEach((file) => {
      const exists = fs.existsSync(file);
      logger.log(`   ${exists ? '✅' : '❌'} ${file}`);
      if (exists && !foundEnvFile) {
        foundEnvFile = file;
        // Read and show first few lines to verify content
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          const apiKeyLine = lines.find(line => line.startsWith('DIALOG_GENIE_API_KEY='));
          if (apiKeyLine) {
            const apiKeyValue = apiKeyLine.split('=')[1]?.trim();
            logger.log(`   📄 Found DIALOG_GENIE_API_KEY in ${file}`);
            logger.log(`   🔑 API Key value (first 30 chars): ${apiKeyValue ? apiKeyValue.substring(0, 30) : 'EMPTY'}`);
            logger.log(`   📏 API Key length: ${apiKeyValue ? apiKeyValue.length : 0}`);
            if (apiKeyValue === 'your_api_key_here') {
              logger.error(`   ⚠️ WARNING: API Key is still the placeholder value!`);
            }
          } else {
            logger.warn(`   ⚠️ DIALOG_GENIE_API_KEY not found in ${file}`);
          }
        } catch (err) {
          logger.error(`   ❌ Error reading file ${file}: ${err}`);
        }
      }
    });
    
    if (!foundEnvFile) {
      logger.error('❌ No env file found! Please ensure server.env exists in the server directory.');
    }

    // Check Dialog Genie API Key
    const dialogGenieConfig = this.configService.get('dialogGenie');
    const apiKeyFromConfig = this.configService.get<string>('DIALOG_GENIE_API_KEY');
    const apiKeyFromProcess = process.env.DIALOG_GENIE_API_KEY;

    logger.log('🔑 Dialog Genie API Key:');
    logger.log(`   ConfigService.get('DIALOG_GENIE_API_KEY'): ${apiKeyFromConfig ? `SET (${apiKeyFromConfig.substring(0, 10)}...)` : 'NOT_SET'}`);
    logger.log(`   process.env.DIALOG_GENIE_API_KEY: ${apiKeyFromProcess ? `SET (${apiKeyFromProcess.substring(0, 10)}...)` : 'NOT_SET'}`);
    logger.log(`   dialogGenie config loaded: ${dialogGenieConfig ? 'YES' : 'NO'}`);

    if (dialogGenieConfig) {
      logger.log(`   Masked API Key: ${dialogGenieConfig.getMaskedApiKey()}`);
      logger.log(`   API Key Configured: ${dialogGenieConfig.isApiKeyConfigured() ? '✅ YES' : '❌ NO'}`);
      logger.log(`   API URL: ${dialogGenieConfig.apiUrl}`);
      logger.log(`   App URL: ${dialogGenieConfig.appUrl}`);
      
      // Debug: Print full API key to verify it's loaded (be careful with this in production!)
      if (dialogGenieConfig.apiKey) {
        console.log('═══════════════════════════════════════');
        console.log('🔑 FULL API KEY (DEBUG MODE):');
        console.log('   Value:', dialogGenieConfig.apiKey);
        console.log('   Length:', dialogGenieConfig.apiKey.length);
        console.log('   First 20 chars:', dialogGenieConfig.apiKey.substring(0, 20));
        console.log('   Last 20 chars:', dialogGenieConfig.apiKey.substring(dialogGenieConfig.apiKey.length - 20));
        console.log('═══════════════════════════════════════');
      } else {
        console.log('❌ API Key is NULL or UNDEFINED in dialogGenieConfig');
      }
    } else {
      console.log('❌ dialogGenieConfig is NULL or UNDEFINED');
    }
    
    // Also check process.env directly
    console.log('═══════════════════════════════════════');
    console.log('🔍 DIRECT process.env CHECK:');
    console.log('   process.env.DIALOG_GENIE_API_KEY:', process.env.DIALOG_GENIE_API_KEY ? `SET (length: ${process.env.DIALOG_GENIE_API_KEY.length})` : 'UNDEFINED');
    if (process.env.DIALOG_GENIE_API_KEY) {
      console.log('   Full value:', process.env.DIALOG_GENIE_API_KEY);
      console.log('   First 20 chars:', process.env.DIALOG_GENIE_API_KEY.substring(0, 20));
      console.log('   Last 20 chars:', process.env.DIALOG_GENIE_API_KEY.substring(process.env.DIALOG_GENIE_API_KEY.length - 20));
    }
    console.log('═══════════════════════════════════════');

    // Validate critical variables
    if (!apiKeyFromConfig && !apiKeyFromProcess) {
      logger.error('❌ CRITICAL: DIALOG_GENIE_API_KEY is not set!');
      logger.error('   Please check:');
      logger.error('   1. server.env file exists in server/ directory');
      logger.error('   2. DIALOG_GENIE_API_KEY=your_key_here is in the file');
      logger.error('   3. No spaces around the = sign');
      logger.error('   4. Value is not quoted (unless needed)');
    }

    logger.log('═══════════════════════════════════════');
  }
}
