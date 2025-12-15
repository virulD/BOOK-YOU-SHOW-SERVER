import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController, PublicEventsController } from './events.controller';
import { UploadController } from './upload.controller';
import { EventsService } from './events.service';
import { Event, EventSchema } from '../schemas/event.schema';
import { EventTeamMember, EventTeamMemberSchema } from '../schemas/event-team-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventTeamMember.name, schema: EventTeamMemberSchema },
    ]),
  ],
  controllers: [EventsController, UploadController, PublicEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}

