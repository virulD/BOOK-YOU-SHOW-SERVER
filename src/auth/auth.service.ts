import { Injectable, UnauthorizedException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, UserDocument, UserRole } from '../schemas/user.schema';
import { RegisterDto, LoginDto, AuthResponseDto, ForgotPasswordDto, ResetPasswordDto } from '../dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto, createdBy?: string): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.userModel.findOne({ email: registerDto.email }).exec();
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user
    const user = new this.userModel({
      ...registerDto,
      password: hashedPassword,
      role: registerDto.role || UserRole.ORGANIZER,
      createdBy: createdBy || undefined,
    });

    const savedUser = await user.save();

    // Generate JWT token
    const payload = { sub: savedUser._id.toString(), email: savedUser.email, role: savedUser.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: savedUser._id.toString(),
        email: savedUser.email,
        name: savedUser.name,
        role: savedUser.role,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    // Find user by email
    const user = await this.userModel.findOne({ email: loginDto.email }).exec();
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const payload = { sub: user._id.toString(), email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async validateUser(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).exec();
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.userModel.findOne({ email: forgotPasswordDto.email.toLowerCase() }).exec();
    
    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      // Still return success message to prevent email enumeration
      return { message: 'If that email exists, a password reset link has been sent.' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    // Set token expiration (1 hour)
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1);

    // Save token to user
    user.passwordResetToken = resetTokenHash;
    user.passwordResetExpires = resetExpires;
    await user.save();

    // Generate reset URL
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${resetToken}`;

    // TODO: Send email with reset link
    // For now, log it (in production, use email service like SendGrid, Nodemailer, etc.)
    console.log('═══════════════════════════════════════');
    console.log('🔐 Password Reset Request');
    console.log('   Email:', user.email);
    console.log('   Reset URL:', resetUrl);
    console.log('   Expires:', resetExpires);
    console.log('   ⚠️  In production, send this via email!');
    console.log('═══════════════════════════════════════');

    return { message: 'If that email exists, a password reset link has been sent.' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    // Hash the token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(resetPasswordDto.token).digest('hex');

    // Find user with valid reset token
    const user = await this.userModel.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() }, // Token not expired
    }).exec();

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    // Update password and clear reset token
    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    return { message: 'Password has been reset successfully. You can now login with your new password.' };
  }
}


