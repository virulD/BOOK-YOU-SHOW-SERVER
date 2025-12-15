import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsArray, IsEnum, IsMongoId, IsOptional, IsBoolean } from 'class-validator';
import { Permission } from '../schemas/event-team-member.schema';
import { UserRole } from '../schemas/user.schema';

export class CreateStaffMemberDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty()
  @IsString()
  @IsMongoId()
  eventId: string;

  @ApiProperty({ type: [String], enum: Permission, required: false })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}

export class AssignStaffToEventDto {
  @ApiProperty()
  @IsString()
  @IsMongoId()
  userId: string;

  @ApiProperty()
  @IsString()
  @IsMongoId()
  eventId: string;

  @ApiProperty({ type: [String], enum: Permission })
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];
}

export class UpdateStaffPermissionsDto {
  @ApiProperty({ type: [String], enum: Permission })
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TeamMemberResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };

  @ApiProperty()
  event: {
    id: string;
    title: string;
  };

  @ApiProperty({ type: [String], enum: Permission })
  permissions: Permission[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  assignedAt: Date;
}


