import { SetMetadata } from '@nestjs/common';
import { Permission } from '../schemas/event-team-member.schema';

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata('permissions', permissions);


