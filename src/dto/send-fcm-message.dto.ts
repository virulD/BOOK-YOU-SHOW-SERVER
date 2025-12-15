import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendFCMMessageDto {
  @ApiProperty({
    description: 'Phone number of the recipient',
    example: '0779132038',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    description: 'Message content to send',
    example: 'Your booking is confirmed. Thank you!',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    description: 'FCM device token (optional, will be fetched from DB if not provided)',
    example: 'dGhpcyBpcyBhIGZha2UgZmNtIHRva2Vu...',
  })
  @IsString()
  @IsOptional()
  fcmToken?: string;
}





























