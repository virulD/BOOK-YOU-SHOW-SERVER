import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { DeviceToken, DeviceTokenSchema } from '../schemas/device-token.schema';
import { FCMMessage, FCMMessageSchema } from '../schemas/fcm-message.schema';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: FCMMessage.name, schema: FCMMessageSchema },
    ]),
    FirebaseModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}

