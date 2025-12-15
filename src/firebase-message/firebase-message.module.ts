import { Module } from '@nestjs/common';
import { FirebaseMessageService } from './firebase-message.service';

@Module({
  providers: [FirebaseMessageService],
  exports: [FirebaseMessageService],
})
export class FirebaseMessageModule {}































