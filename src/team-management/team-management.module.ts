import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamManagementService } from './team-management.service';
import { TeamManagementController } from './team-management.controller';
import { User, UserSchema } from '../schemas/user.schema';
import { EventTeamMember, EventTeamMemberSchema } from '../schemas/event-team-member.schema';
import { Event, EventSchema } from '../schemas/event.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: EventTeamMember.name, schema: EventTeamMemberSchema },
      { name: Event.name, schema: EventSchema },
    ]),
    AuthModule,
  ],
  controllers: [TeamManagementController],
  providers: [TeamManagementService],
  exports: [TeamManagementService],
})
export class TeamManagementModule {}


