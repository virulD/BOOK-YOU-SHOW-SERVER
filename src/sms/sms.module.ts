import { Module, forwardRef } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { DialogEsmsModule } from '../dialog-esms/dialog-esms.module';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [forwardRef(() => DialogEsmsModule), FirebaseModule],
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}

